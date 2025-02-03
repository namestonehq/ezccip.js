# ezccip.js

Turnkey [EIP-3668: CCIP-Read](https://eips.ethereum.org/EIPS/eip-3668) Handler for ENS and arbitrary functions.

`npm i @namestone/ezccip` [&check;](https://www.npmjs.com/package/@namestone/ezccip)

- see [**types**](./dist/index.d.mts) / uses [ethers](https://github.com/ethers-io/ethers.js/)
- works with any server infrastructure
  - uses minimal imports for serverless
- implements multiple protocols:
  - `"tor"` &mdash; [namestonehq/**TheOffchainResolver.sol**](https://github.com/namestonehq/TheOffchainResolver.sol)
  - `"ens"` &mdash; [ensdomains/**offchain-resolver**](https://github.com/ensdomains/offchain-resolver/) and [ccip.tools](https://ccip.tools/)
  - `"raw"` &mdash; raw response (EVM Gateway, testing, etc.)
- used by [namestonehq/**TheOffchainGateway.js**](https://github.com/namestonehq/TheOffchainGateway.js)
- `enableENSIP10()` drop-in support for [namestonehq/**enson.js**](https://github.com/namestonehq/enson.js) **Record**-type
- supports _Multicall-over-CCIP-Read_
  - `resolve(name, multicall([...]))`
  - `multicall([resolve(name, ...), ...])`
  - `multicall([resolve(name, multicall([...])), ...])`
- use [`serve()`](#serve) to quickly launch a server
- [**CCIP Postman**](https://namestonehq.github.io/ezccip.js/test/postman.html) ⭐️
  - directly debug any CCIP-Read server (no RPC)

## Demo

1. `npm run start` &mdash; starts a CCIP-Read server for [**TOR**](https://github.com/namestonehq/TheOffchainResolver.sol#context-format) protocol using [`serve()`](#serve)
1. check [Postman](https://namestonehq.github.io/ezccip.js/test/postman.html#endpoint=https%3A%2F%2Fraffy.xyz%2Fezccip%2F&proto=tor&name=raffy.eth&multi=inner&field=addr-&field=text-description) &larr; change to `http://localhost:8016`
1. choose a TOR:
   1. [**TOR** on Mainnet or Sepolia](https://github.com/namestonehq/TheOffchainResolver.sol#theoffchainresolversol)
   1. [**DNSTORWithENSProtocol** on Mainnet or Sepolia](https://github.com/namestonehq/TheOffchainResolver.sol?tab=readme-ov-file#dnstorwithensprotocolsol)
1. [setup](https://github.com/namestonehq/TheOffchainResolver.sol#setup) Context: `0xd00d726b2aD6C81E894DC6B87BE6Ce9c5572D2cd http://localhost:8016`

### Examples

- **DNS** (using `"tor"` protocol on Mainnet): [`ezccip.raffy.xyz`](https://adraffy.github.io/ens-normalize.js/test/resolver.html#ezccip.raffy.xyz)
  - Resolver: [`0x7CE6Cf740075B5AF6b1681d67136B84431B43AbD`](https://etherscan.io/address/0x7CE6Cf740075B5AF6b1681d67136B84431B43AbD)
  - Context: `0xd00d726b2aD6C81E894DC6B87BE6Ce9c5572D2cd https://raffy.xyz/ezccip/0x7CE6Cf740075B5AF6b1681d67136B84431B43AbD`
- **ENS** (using `"tor"` protocol on Sepolia): [`ezccip.eth`](https://adraffy.github.io/ens-normalize.js/test/resolver.html?sepolia#ezccip.eth)
  - Resolver: [`0x3c187BAb6dC2C94790d4dA5308672e6F799DcEC3`](https://sepolia.etherscan.io/address/0x3c187BAb6dC2C94790d4dA5308672e6F799DcEC3)
  - Context: `0xd00d726b2aD6C81E894DC6B87BE6Ce9c5572D2cd https://raffy.xyz/ezccip/0x3c187BAb6dC2C94790d4dA5308672e6F799DcEC3`
- **DNS** (using `"ens"` protocol on Mainnet) [`ens.ezccip.raffy.xyz`](https://adraffy.github.io/ens-normalize.js/test/resolver.html#ens.ezccip.raffy.xyz)
  - Resolver: [0x3CA097Edd180Ea2C2436BD30c021Ca20869087a0](https://etherscan.io/address/0x3CA097Edd180Ea2C2436BD30c021Ca20869087a0)
  - Contect: `0xd00d726b2aD6C81E894DC6B87BE6Ce9c5572D2cd https://raffy.xyz/ezccip/0x3CA097Edd180Ea2C2436BD30c021Ca20869087a0`

## Usage

Create an instance and register some handlers.

```js
import { EZCCIP } from "@namestone/ezccip";

let ezccip = new EZCCIP();

// implement an arbitrary function
ezccip.register("add(uint256, uint256) returns (uint256)", ([a, b]) => [a + b]);

// implement a wildcard ENSIP-10 resolver
// which handles resolve() automatically
ezccip.enableENSIP10(async (name, context) => {
  return {
    async text(key) {
      switch (key) {
        case "name":
          return "Raffy";
        case "avatar":
          return "https://raffy.antistupid.com/ens.jpg";
      }
    },
  };
});

// more complicated example
let abi = new ethers.Interface([
  "function f(bytes32 x) returns (string)",
  "function g(uint256 a, uint256 b) returns (uint256)",
]);
ezccip.register(abi, {
  // register multiple functions at once using existing ABI
  async ["f(bytes32)"]([x], context, history) {
    // match function by signature
    history.show = [context.sender]; // replace arguments of f(...) in logger
    history.name = "Chonk"; // rename f() to Chonk() in logger
    return [context.calldata]; // echo incoming calldata
  },
  async ["0xe2179b8e"]([a, b], context) {
    // match by selector
    context.protocol = "tor"; // override signing protocol
    return ethers.toBeHex(1337n, 32); // return raw encoded result
  },
});
```

When your server has a request for CCIP-Read, use EZCCIP to produce a response.

```js
let { sender, data: calldata } = JSON.parse(req.body); // ABI-encoded request in JSON from EIP-3668
let { data, history } = await ezccip.handleRead(sender, calldata, {
  protocol: "tor", // default, tor requires signingKey + resolver
  signingKey, // your private key
});
reply.json({ data }); // ABI-encoded response in JSON for EIP-3668
console.log(history.toString()); // description of response
```

- implement via `GET`, `POST`, or query directly
- `context` carries useful information about the incoming request
- `history` collects information as the response is generated

### serve()

Start a [simple server](./src/serve.js) for an EZCCIP instance or a function representing the `enableENSIP10()` handler.

```js
import { serve } from "@namestone/ezccip/serve";
let ccip = await serve(ezccip); // see types for more configuration
// ...
await ccip.shutdown();

// minimal example:
// return fixed text() for any name
await serve(() => {
  text: () => "Raffy";
});
```

#### Sender vs Origin

- ⚠️ `sender` may not be the originating contract
  - see: [recursive CCIP-Read](https://eips.ethereum.org/EIPS/eip-3668#recursive-calls-in-ccip-aware-contracts)
- **Best Solution**: embed `origin` into the endpoint as a path component:
  1.  `http://my.server/.../0xABCD/...`
  1.  `origin = 0xABCD`
- or, use `parseOrigin(path: string) => string` to extract `origin` from an arbitrary path
- or, supply a fallback `origin`
- if `origin` is not detected, `origin = sender`

### processENSIP10()

Apply ENSIP-10 `calldata` to a `Record`-object and generate the corresponding ABI-encoded response. This is a free-function.

```js
let record = {
    text(key) { if (key == 'name') return 'raffy'; }
    addr(type) { if (type == 60) return '0x1234'; }
};
let calldata = '0x...'; // encodeFunctionData('text', ['name']);
let res = await processENSIP10(record, calldata); // encodeFunctionResult('text', ['raffy']);
```
