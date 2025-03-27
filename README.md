# Shardex Decentralized Exchange

[![TON](https://img.shields.io/badge/based%20on-TON-blue)](https://ton.org/)
[![License](https://img.shields.io/badge/license-GPL--3.0-brightgreen)](https://opensource.org/licenses/GPL-3.0)

Contracts for the [shardex.finance](https://www.shardex.finance/) DEX protocol.

## Project structure

-   `contracts` - source code of all the smart contracts of the project and their dependencies.
-   `wrappers` - wrapper classes (implementing `Contract` from ton-core) for the contracts, including any [de]serialization primitives and compilation functions.
-   `tests` - tests for the contracts.
-   `scripts` - scripts used by the project, mainly the deployment scripts.

## How to use

### Build

`npx blueprint build` or `yarn blueprint build`

### Test

`npx blueprint test` or `yarn blueprint test`

### Deploy or run another script

`npx blueprint run` or `yarn blueprint run`

### Add a new contract

`npx blueprint create ContractName` or `yarn blueprint create ContractName`

## Licensing

The license for Shardex Decentralized Exchange is the GNU General Public License v3.0 (GPL-3.0), see [LICENSE](LICENSE).
