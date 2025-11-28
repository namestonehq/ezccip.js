import {EZCCIP} from '../src/ezccip.js'; 
import {serve} from '../src/serve.js'; 
import {readFileSync} from 'node:fs';
import { COIN_TYPE_DEFAULT } from '../src/utils.js';

const DNSTORWithENSProtocol = '0x3CA097Edd180Ea2C2436BD30c021Ca20869087a0';

const {version} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

const ezccip = new EZCCIP();
ezccip.register('example(uint256, uint256) returns (uint256)', ([a, b]) => [a * 1000n + b]);
ezccip.enableENSIP10(async (name, context) => {
	if (context.origin === DNSTORWithENSProtocol) {
		context.protocol = 'ens'; // dynamic protocol change
	}
	return {
		addr(type) {
			switch (type) {
				case COIN_TYPE_DEFAULT: return '0x51050ec063d393217b436747617ad1c2285aeeee';
				case 3n: return '0x76a9149eb02ebe2f323494320f9b1153f07a2e0eff528588ac'; // encoded $doge address
			}
		},
		data(key) {
			switch (key) {
				case 'test': return '0x1234';
			}
		},
		text(key) {
			switch (key) {
				case 'name': return `ezccip Demo for ${name} (v${version})`;
				case 'notice': return new Date().toLocaleString();
				case 'description': return `Connection from ${context.ip}`;
				case 'avatar': return 'https://raffy.xyz/ens.jpg';
				case 'location': return `Protocol(${context.protocol}) Sender(${context.sender})`;
			}
		},
		pubkey() {
			return {x: 1, y: 2};
		},
		contenthash() { 
			return '0xe301017012201687de19f1516b9e560ab8655faa678e3a023ebff43494ac06a36581aafc957e'; // vitaliks blog
		},
		ABI(types) {
			return {type: 0, data: '0x'};
		}
	};
});

await serve(ezccip, {
	port: 8016,
	protocol: 'tor',
	signingKey: '0xbd1e630bd00f12f0810083ea3bd2be936ead3b2fa84d1bd6690c77da043e9e02',
});
