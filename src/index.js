import {is_hex, labels_from_dns_encoded, asciiize} from './utils.js';
import {History} from './History.js';
import {ethers} from 'ethers';

const ABI_CODER = ethers.AbiCoder.defaultAbiCoder();

export const CCIP_ABI = cache_abi(new ethers.Interface([
	'function resolve(bytes name, bytes data) external view returns (bytes)',
	'function multicall(bytes[] calls) external view returns (bytes[])',
]));

export const RESOLVER_ABI = cache_abi(new ethers.Interface([
	'function name(bytes32 node) external view returns (string)',
	'function addr(bytes32 node) external view returns (address)',
	'function addr(bytes32 node, uint256 type) external view returns (bytes)',
	'function text(bytes32 node, string key) external view returns (string)',
	'function contenthash(bytes32 node) external view returns (bytes)',
	'function pubkey(bytes32 node) external view returns (uint256 x, uint256 y)',
	'function ABI(bytes32 node, uint256 types) external view returns (uint256 type, bytes memory data)',
	'function multicall(bytes[] calls) external view returns (bytes[])',
]));

export class RESTError extends Error {
	constructor(status, message, cause) {
		super(message, {cause});
		this.status = status;
		if (cause && !this.cause) this.cause = cause;
	}
}

// https://eips.ethereum.org/EIPS/eip-3668
export async function handleCCIPRead({sender, request, getRecord, signingKey, resolver, recursionLimit = 2, ttlSec = 60} = {}) {
	if (!is_hex(sender) || sender.length !== 42) throw new RESTError(400, 'expected sender address');
	if (!is_hex(request) || request.length < 10) throw new RESTError(400, 'expected calldata');
	sender = sender.toLowerCase();
	request = request.toLowerCase();
	let history = new History(recursionLimit);
	try {
		let response = await handle_ccip_call(sender, request, getRecord, history);
		let expires = Math.floor(Date.now() / 1000) + ttlSec;
		let hash = ethers.solidityPackedKeccak256(
			['address', 'uint64', 'bytes32', 'bytes32'],
			[resolver, expires, ethers.keccak256(request), ethers.keccak256(response)]
		);
		let data = ABI_CODER.encode(['bytes', 'uint64', 'bytes'], [signingKey.sign(hash).serialized, expires, response]);
		return {data, history};
	} catch (err) {
		throw new RESTError(500, 'invalid request', err);
	}
}


async function handle_ccip_call(sender, data, getRecord, history) {
	try {
		let method = data.slice(0, 10);
		let call = CCIP_ABI.getFunction(method);
		if (!call) throw new Error(`unsupported ccip method: ${method}`);
		let args = CCIP_ABI.decodeFunctionData(call, data);
		switch (call.__name) {
			case 'resolve(bytes,bytes)': {
				let labels = labels_from_dns_encoded(ethers.getBytes(args.name));
				let name = labels.join('.');
				history.add({desc: `resolve(${asciiize(name)})`, call, name});
				let record = await getRecord({labels, name, sender});
				return await handle_resolve(record, args.data, history);
				// returns without additional encoding
			}
			case 'multicall(bytes)': {
				history.add({desc: 'multicall', call});
				args = [await Promise.all(args.calls.map(x => handle_ccip_call(sender, x, getRecord, history.enter()).catch(encode_error)))];
				break;
			}
		}
		return CCIP_ABI.encodeFunctionResult(call, args);
	} catch (err) {
		history.error = err;
		throw err;
	}
}

async function handle_resolve(record, calldata, history) {	
	try {
		let method = calldata.slice(0, 10);
		let call = RESOLVER_ABI.getFunction(method);
		if (!call) throw new Error(`unsupported resolve() method: ${method}`);
		let args = RESOLVER_ABI.decodeFunctionData(call, calldata);
		let res;
		switch (call.__name) {		
			case 'multicall(bytes[])': {
				// https://github.com/ensdomains/ens-contracts/blob/staging/contracts/resolvers/IMulticallable.sol
				history.add({desc: 'multicall'});
				res = [await Promise.all(args.calls.map(x => handle_resolve(record, x, history.enter()).catch(encode_error)))];
				break;
			}
			case 'addr(bytes32)': {
				// https://eips.ethereum.org/EIPS/eip-137
				history.add({desc: 'addr()', call});
				let value = await record?.addr?.(60);
				res = [value ? ethers.hexlify(value) : ethers.ZeroAddress];
				break;
			}
			case 'addr(bytes32,uint256)': {
				// https://eips.ethereum.org/EIPS/eip-2304
				let type = Number(args.type); // TODO: BigInt => number
				history.add({desc: `addr(${addr_type_str(type)})`, call, type});
				let value = await record?.addr?.(type);
				res = [value || '0x'];
				break;
			}
			case 'text(bytes32,string)': {
				// https://eips.ethereum.org/EIPS/eip-634
				let {key} = args;
				history.add({desc: `text(${asciiize(key)})`, call, key});
				let value = await record?.text?.(key);
				res = [value || ''];
				break;
			}
			case 'contenthash(bytes32)': {
				// https://docs.ens.domains/ens-improvement-proposals/ensip-7-contenthash-field
				history.add({desc: 'contenthash()', call});
				let value = await record?.contenthash?.();
				res = [value || '0x'];
				break;
			}
			case 'pubkey(bytes32)': {
				// https://github.com/ethereum/EIPs/pull/619
				history.add({desc: 'pubkey()', call});
				let value = await record?.pubkey?.();
				res = value ? [value.x, value.y] : [0, 0];
				break;
			}
			case 'name(bytes32)': {
				// https://eips.ethereum.org/EIPS/eip-181
				history.add({desc: 'name()', call});
				let value = await record?.name?.();
				res = [value || ''];
				break;
			}
			case 'ABI(bytes32,uint256)': {
				// https://docs.ens.domains/ens-improvement-proposals/ensip-4-support-for-contract-abis
				let types = Number(args.types);
				history.add({desc: `ABI(${abi_types_str(types)})`, call, types});
				let value = await record?.ABI?.(types);
				res = value ? [value.type, value.data] : [0, '0x'];
				break;
			}
		}
		return RESOLVER_ABI.encodeFunctionResult(call, res);
	} catch (err) {
		history.error = err;
		throw err;
	}
}

// format exception as `error Error(string)`
function encode_error(err) {
	return '0x08c379a0' + ABI_CODER.encode(['string'], [err.message]).slice(2);
}

// precompute all of the function names
function cache_abi(abi) {
	abi.forEachFunction(x => x.__name = x.format());
	return abi;
}

// shorter coin names
function addr_type_str(type) {
	const msb = 0x80000000;
	return type >= msb ? `evm:${type-msb}` : type;
}

// visible abi types
function abi_types_str(types) {
	let v = [];
	if (types & 1) v.push('JSON');
	if (types & 2) v.push('zip(JSON)');
	if (types & 4) v.push('CBOR');
	if (types & 8) v.push('URI');
	return v.join('|');
}
