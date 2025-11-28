import {processENSIP10, EZCCIP, RESOLVE_ABI} from '../src/ezccip.js'; 
import {ethers} from 'ethers';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('addr() => address', async T => {
	const call = RESOLVE_ABI.encodeFunctionData('addr(bytes32)', [ethers.ZeroHash]);
	function make(name, data) {
		return T.test(name, async () => {
			const encoded = await processENSIP10({
				addr() { return data; }
			}, call);
			const expected = '0x' + (data ? ethers.hexlify(data).slice(2) : '').slice(0, 40).padStart(64, '0')
			assert.equal(encoded, expected);
		});
	}
	const v = ethers.randomBytes(63);
	await make('Uint8Array(0)', v.subarray(0, 0));
	await make('Uint8Array(19)', v.subarray(v, 0, 19));
	await make('Uint8Array(20)', v.subarray(v, 0, 20))
	await make('Uint8Array(21)', v.subarray(v, 0, 21));
	await make('Uint8Array(63)', v);
	await make('hex(0)', ethers.dataSlice(v, 0));
	await make('hex(19)', ethers.dataSlice(v, 19));
	await make('hex(20)', ethers.dataSlice(v, 20));
	await make('hex(21)', ethers.dataSlice(v, 21));
	await make('null', null);
	await make('undefined');
});

test('addr() => bytes', async T => {
	const call = RESOLVE_ABI.encodeFunctionData('addr(bytes32,uint256)', [ethers.ZeroHash, 0]);
	function make(name, data) {
		return T.test(name, async () => {
			let encoded = await processENSIP10({
				addr() { return data; }
			}, call);
			assert.equal(encoded, ethers.AbiCoder.defaultAbiCoder().encode(['bytes'], [data || '0x']));
		});
	}
	await make('Uint8Array(0)', new Uint8Array(0));
	await make('Uint8Array', ethers.randomBytes(63));
	await make('null hex', '0x');
	await make('hex', '0x12');
	await make('null', null);
	await make('undefined');
});

test('unreachableAsEmpty', async T => {
	const sender = ethers.ZeroAddress;
	const calldata = RESOLVE_ABI.encodeFunctionData('resolve', ['0x00', RESOLVE_ABI.encodeFunctionData('addr(bytes32)', [ethers.ZeroHash])]);
	await T.test('false (default)', async () => {
		const ezccip = new EZCCIP();
		ezccip.enableENSIP10(() => undefined);
		const {data} = await ezccip.handleRead(sender, calldata, {protocol: 'raw'});
		assert.equal(data, RESOLVE_ABI.encodeErrorResult('UnreachableName', ['0x00']));
	});
	await T.test('true', async () => {
		const ezccip = new EZCCIP();
		ezccip.enableENSIP10(() => undefined, { unreachableAsEmpty: true });
		const {data} = await ezccip.handleRead(sender, calldata, {protocol: 'raw'});
		assert.equal(data, '0x0000000000000000000000000000000000000000000000000000000000000000');
	});
});

test('throwErrors', async T => {
	const selector = '0x12345678';
	await T.test('false (default)', async () => {
		assert.equal(await processENSIP10(undefined, selector), RESOLVE_ABI.encodeErrorResult('UnsupportedResolverProfile', [selector]));
	});
	await T.test('true', async () => {
		await assert.rejects(() => processENSIP10(undefined, selector, { throwErrors: true }));
	});
});
