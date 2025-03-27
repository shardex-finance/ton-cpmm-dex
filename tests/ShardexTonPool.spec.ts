import { compile } from '@ton/blueprint';
import { Address, beginCell, Cell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import { findTransactionRequired } from '@ton/test-utils';
import BigNumber from 'bignumber.js';
import { jettonContentToCell, JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import { Opcodes, ShardexPool, ShardexTokensData } from '../wrappers/ShardexPool';
import { ShardexPoolJettonWallet } from '../wrappers/ShardexPoolJettonWallet';
import { PoolTokenKind, PoolVersion } from '../wrappers/state';
import { TonVault } from '../wrappers/TonVault';
import { TestTonSwaps } from './testUtils';

describe('ShardexTonPool', () => {
    let jwallet_code = new Cell();
    let minter_code = new Cell();
    let poolCode: Cell;
    let lpWalletCode: Cell;
    let tonVaultCode: Cell;

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let user: SandboxContract<TreasuryContract>;
    let userSecond: SandboxContract<TreasuryContract>;

    let jettonMinterB: SandboxContract<JettonMinter>;
    let userWalletB: SandboxContract<JettonWallet>;

    let tonVault: SandboxContract<TonVault>;

    let shardexPool: SandboxContract<ShardexPool>;

    let jettonWalletB: Address;

    let index = 0;

    const jettonTotal = toNano(toNano(toNano(1000)));

    beforeAll(async () => {
        tonVaultCode = await compile('TonVault');

        poolCode = await compile('ShardexPool');
        lpWalletCode = await compile('ShardexPoolJettonWallet');

        jwallet_code = await compile('JettonWallet');
        minter_code = await compile('JettonMinter');

        blockchain = await Blockchain.create();

        deployer = await blockchain.treasury('deployer');
        user = await blockchain.treasury('userA');
        userSecond = await blockchain.treasury('userB');

        jettonMinterB = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    admin: deployer.address,
                    jetton_content: jettonContentToCell({ uri: 'https://testjetton.org/content.json' }),
                    wallet_code: jwallet_code,
                },
                minter_code
            )
        );

        await jettonMinterB.sendMint(
            deployer.getSender(),
            user.address,
            jettonTotal,
            null,
            null,
            null,
            toNano('0.05'),
            toNano('1')
        );
        await jettonMinterB.sendMint(
            deployer.getSender(),
            userSecond.address,
            jettonTotal,
            null,
            null,
            null,
            toNano('0.05'),
            toNano('1')
        );

        userWalletB = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinterB.getWalletAddress(user.address))
        );
    });

    beforeEach(async () => {
        shardexPool = blockchain.openContract(
            ShardexPool.createFromConfig(
                {
                    admin: deployer.address,
                    index: index++,
                    tokenA: { kind: PoolTokenKind.ton },
                    tokenB: { kind: PoolTokenKind.jetton, address: jettonMinterB.address },
                    lpWalletCode: lpWalletCode,
                    version: PoolVersion.v0,
                },
                poolCode
            )
        );

        tonVault = await blockchain.openContract(
            TonVault.createFromConfig(
                {
                    owner: shardexPool.address,
                },
                tonVaultCode
            )
        );

        jettonWalletB = await jettonMinterB.getWalletAddress(shardexPool.address);

        const deployVault = await tonVault.sendDeploy(deployer.getSender(), toNano('0.01'));

        expect(deployVault.transactions).toHaveTransaction({
            from: deployer.address,
            to: tonVault.address,
            deploy: true,
            success: true,
        });

        const deployResult = await shardexPool.sendDeploy(deployer.getSender(), toNano('0.05'), {
            vaultA: tonVault.address,
            vaultB: jettonWalletB,
            fee: 20,
            content: beginCell().endCell(),
        });

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: shardexPool.address,
            deploy: true,
            success: true,
        });
    });

    function compare(before: ShardexTokensData, after: ShardexTokensData) {
        const kBefore = before.tokenAAmount.multipliedBy(before.tokenBAmount);
        const kAfter = after.tokenAAmount.multipliedBy(after.tokenBAmount);
        expect(kAfter.toNumber()).toBeGreaterThanOrEqual(kBefore.toNumber());
    }

    async function swapTonJetton(opts: {
        account: SandboxContract<TreasuryContract>;
        amountIn: bigint;
        slippage?: number;
        responseAddress?: Address;
        customFee?: number;
    }) {
        const before = await shardexPool.getTokensData();

        const amountOut = await shardexPool.getSwapRate({
            vaultIn: tonVault.address,
            amountIn: opts.amountIn,
            customFee: opts.customFee,
        });

        const message = ShardexPool.swapMessage({
            amountOut: amountOut,
            slippage: opts.slippage,
            responseAddress: opts.responseAddress,
            customFee: opts.customFee,
        });

        const send = await tonVault.sendDeposit(
            opts.account.getSender(),
            opts.amountIn + toNano('0.1'),
            opts.amountIn,
            opts.account.address,
            toNano('0.05'),
            message
        );

        const after = await shardexPool.getTokensData();

        compare(before, after);
        return { send, amountOut };
    }

    async function swapJettonTon(opts: {
        account: SandboxContract<TreasuryContract>;
        jettonMinterIn: SandboxContract<JettonMinter>;
        amountIn: bigint;
        slippage?: number;
        responseAddress?: Address;
        customFee?: number;
    }) {
        const jettonWalletIn = JettonWallet.createFromAddress(
            await opts.jettonMinterIn.getWalletAddress(shardexPool.address)
        );

        const before = await shardexPool.getTokensData();

        const amountOut = await shardexPool.getSwapRate({
            vaultIn: jettonWalletIn.address,
            amountIn: opts.amountIn,
            customFee: opts.customFee,
        });

        // console.log('amountIn', opts.amountIn.toString(), 'amountOut', amountOut.toString());
        const message = ShardexPool.swapMessage({
            amountOut: amountOut,
            slippage: opts.slippage,
            responseAddress: opts.responseAddress,
            forwardTonAmount: BigInt(0),
            customFee: opts.customFee,
        });

        const jettonWalletAddress = await opts.jettonMinterIn.getWalletAddress(opts.account.address);
        const wallet = blockchain.openContract(JettonWallet.createFromAddress(jettonWalletAddress));

        const send = await wallet.sendTransfer(
            opts.account.getSender(),
            toNano('0.1'),
            opts.amountIn,
            shardexPool.address,
            opts.account.address,
            null,
            toNano('0.05'),
            message
        );

        const after = await shardexPool.getTokensData();

        compare(before, after);
        return { send, amountOut };
    }

    async function deposit(opts: { account: SandboxContract<TreasuryContract>; amountA: bigint; amountB: bigint }) {
        const message = ShardexPool.depositMessage({
            responseAddress: opts.account.address,
        });

        const sendA = await tonVault.sendDeposit(
            opts.account.getSender(),
            opts.amountA + toNano(0.2),
            opts.amountA,
            opts.account.address,
            toNano('0.1'),
            message
        );

        const walletB = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinterB.getWalletAddress(opts.account.address))
        );
        const sendB = await walletB.sendTransfer(
            opts.account.getSender(),
            toNano('0.2'),
            opts.amountB,
            shardexPool.address,
            opts.account.address,
            null,
            toNano('0.1'),
            message
        );
        return { sendA, sendB, message };
    }

    it('should deploy', async () => {
        const data = await shardexPool.getPoolData();
        //  console.log(data);
        expect(data.admin).toBeDefined();
    });

    describe('Deposit', () => {
        for (let { amountA, amountB, lpResult } of [
            { amountA: toNano(10), amountB: toNano(100), lpResult: BigInt(31622776) },
            { amountA: toNano(100), amountB: toNano(10), lpResult: BigInt(31622776) },
            { amountA: toNano(10000), amountB: toNano(toNano(100)), lpResult: BigInt('31622776601683') },
        ]) {
            it(`should create  deposit for lp amount ${lpResult.toString()}`, async () => {
                const lpWalletAddress = await shardexPool.getWalletAddress(user.address);
                const { sendA, sendB, message } = await deposit({
                    account: user,
                    amountA,
                    amountB,
                });

                // send first token and start mint lp jetton
                expect(sendA.transactions).toHaveTransaction({
                    from: user.address,
                    to: tonVault.address,
                    success: true,
                });
                expect(sendA.transactions).toHaveTransaction({
                    from: tonVault.address,
                    to: shardexPool.address,
                    success: true,
                    body: TonVault.transferNotificationMessage({
                        tokenAmount: amountA,
                        owner: user.address,
                        forwardPayload: message,
                    }),
                });

                expect(sendA.transactions).toHaveTransaction({
                    from: shardexPool.address,
                    to: lpWalletAddress,
                    success: true,
                    deploy: true,
                });

                expect(sendA.transactions).toHaveTransaction({
                    from: lpWalletAddress,
                    to: user.address,
                    success: true,
                });

                // send second token and complete mint lp jetton
                expect(sendB.transactions).toHaveTransaction({
                    from: user.address,
                    to: userWalletB.address,
                    success: true,
                });
                expect(sendB.transactions).toHaveTransaction({
                    from: userWalletB.address,
                    to: jettonWalletB,
                    success: true,
                });
                expect(sendB.transactions).toHaveTransaction({
                    from: jettonWalletB,
                    to: shardexPool.address,
                    success: true,
                });
                expect(sendB.transactions).toHaveTransaction({
                    from: shardexPool.address,
                    to: lpWalletAddress,
                    success: true,
                });
                expect(sendB.transactions).toHaveTransaction({
                    from: lpWalletAddress,
                    to: shardexPool.address,
                    success: true,
                    body: ShardexPool.depositNotificationMessage({
                        amountA,
                        amountB,
                        owner: user.address,
                        responseAddress: user.address,
                    }),
                });

                expect(sendB.transactions).toHaveTransaction({
                    from: shardexPool.address,
                    to: lpWalletAddress,
                    success: true,
                    body: ShardexPoolJettonWallet.internalMessage({
                        jettonAmount: lpResult,
                        to: user.address,
                        responseAddress: user.address,
                        forwardTonAmount: BigInt(1),
                        forwardPayload: null,
                    }),
                });

                const data = await shardexPool.getTokensData();
                // console.log(data);
                expect(data.tokenAAmount.toString()).toBe(amountA.toString());
                expect(data.tokenBAmount.toString()).toBe(amountB.toString());

                const lpWallet = blockchain.openContract(ShardexPoolJettonWallet.createFromAddress(lpWalletAddress));

                const balance = await lpWallet.getJettonBalance();
                expect(balance.toString()).toBe(lpResult.toString());
            });

            it(`should deposit for lp amount ${lpResult.toString()} and discover rate`, async () => {
                await deposit({
                    account: user,
                    amountA,
                    amountB,
                });

                const rate = await shardexPool.sendProvidePoolRate(userSecond.getSender(), toNano(0.1), {});

                expect(rate.transactions).toHaveTransaction({
                    from: shardexPool.address,
                    to: userSecond.address,
                    success: true,
                    body: ShardexPool.takeRateMessage({
                        amountA,
                        amountB,
                    }),
                });
            });

            it(`should deposit for lp amount ${lpResult.toString()} and discover rate to target contract`, async () => {
                await deposit({
                    account: user,
                    amountA,
                    amountB,
                });

                const rate = await shardexPool.sendProvidePoolRate(userSecond.getSender(), toNano(0.1), {
                    address: user.address,
                });

                expect(rate.transactions).toHaveTransaction({
                    from: shardexPool.address,
                    to: user.address,
                    success: true,
                    body: ShardexPool.takeRateMessage({
                        amountA,
                        amountB,
                    }),
                });
            });
        }
    });

    describe('Swap', () => {
        for (let { amountA, amountB, amountIn } of TestTonSwaps) {
            it(`should swap ton to jetton ${amountIn.toString()}`, async () => {
                await deposit({ account: user, amountA, amountB });

                const { send } = await swapTonJetton({
                    account: userSecond,
                    amountIn,
                });

                const userWalletB = blockchain.openContract(
                    JettonWallet.createFromAddress(await jettonMinterB.getWalletAddress(userSecond.address))
                );

                expect(send.transactions).toHaveTransaction({
                    from: tonVault.address,
                    to: shardexPool.address,
                    success: true,
                });
                expect(send.transactions).toHaveTransaction({
                    from: shardexPool.address,
                    to: jettonWalletB,
                    success: true,
                });
                expect(send.transactions).toHaveTransaction({
                    from: jettonWalletB,
                    to: userWalletB.address,
                    success: true,
                });
            });

            it(`should swap jetton to ton ${amountIn.toString()}`, async () => {
                await deposit({ account: user, amountA, amountB });

                const { send, amountOut } = await swapJettonTon({
                    account: userSecond,
                    jettonMinterIn: jettonMinterB,
                    amountIn,
                    slippage: 10,
                    responseAddress: userSecond.address,
                });

                const userWalletB = blockchain.openContract(
                    JettonWallet.createFromAddress(await jettonMinterB.getWalletAddress(userSecond.address))
                );

                expect(send.transactions).toHaveTransaction({
                    from: userWalletB.address,
                    to: jettonWalletB,
                    success: true,
                });

                expect(send.transactions).toHaveTransaction({
                    from: jettonWalletB,
                    to: shardexPool.address,
                    success: true,
                });
                expect(send.transactions).toHaveTransaction({
                    from: shardexPool.address,
                    to: tonVault.address,
                    success: true,
                });

                if (amountOut > 0) {
                    expect(send.transactions).toHaveTransaction({
                        from: tonVault.address,
                        to: userSecond.address,
                        //  value: amountOut, it's same +- 1n because of rounding
                        body: new Cell(),
                    });
                }

                expect(send.transactions).toHaveTransaction({
                    from: tonVault.address,
                    to: userSecond.address,
                    success: true,
                    body: TonVault.excessesMessage({}),
                });
            });

            // it(`should swap jetton to ton with custom fee ${amountIn.toString()}`, async () => {
            //     await deposit({ account: user, amountA, amountB });

            //     const { send, amountOut } = await swapJettonTon({
            //         account: userSecond,
            //         jettonMinterIn: jettonMinterB,
            //         amountIn,
            //         slippage: 10,
            //         responseAddress: userSecond.address,
            //         customFee: 500 // 5%
            //     });

            //     const userWalletB = blockchain.openContract(
            //         JettonWallet.createFromAddress(await jettonMinterB.getWalletAddress(userSecond.address)),
            //     );

            //     expect(send.transactions).toHaveTransaction({
            //         from: userWalletB.address,
            //         to: jettonWalletB,
            //         success: true,
            //     });

            //     expect(send.transactions).toHaveTransaction({
            //         from: jettonWalletB,
            //         to: shardexPool.address,
            //         success: true,
            //     });
            //     expect(send.transactions).toHaveTransaction({
            //         from: shardexPool.address,
            //         to: tonVault.address,
            //         success: true,
            //     });

            //     if (amountOut > 0) {
            //         expect(send.transactions).toHaveTransaction({
            //             from: tonVault.address,
            //             to: userSecond.address,
            //             value: amountOut, // it's same +- 1n because of rounding
            //             body: new Cell(),
            //         });
            //     }

            //     expect(send.transactions).toHaveTransaction({
            //         from: tonVault.address,
            //         to: userSecond.address,
            //         success: true,
            //         body: TonVault.excessesMessage({}),
            //     });
            // });
        }
    });

    describe('Boost', () => {
        it(`should create deposit and boost pool with correct messages`, async () => {
            const amount = toNano(100);
            await deposit({
                account: user,
                amountA: amount,
                amountB: amount,
            });
            await deposit({
                account: userSecond,
                amountA: amount,
                amountB: amount,
            });

            const lpWallet = blockchain.openContract(
                ShardexPoolJettonWallet.createFromAddress(await shardexPool.getWalletAddress(userSecond.address))
            );

            const half = BigInt(new BigNumber((await lpWallet.getJettonBalance()).toString()).div(2).toFixed(0));
            const boost = await lpWallet.sendBoost(userSecond.getSender(), toNano('0.2'), half, userSecond.address);

            expect(boost.transactions).toHaveTransaction({
                from: userSecond.address,
                to: lpWallet.address,
                success: true,
                body: ShardexPoolJettonWallet.boostMessage(half, userSecond.address),
            });

            expect(boost.transactions).toHaveTransaction({
                from: lpWallet.address,
                to: shardexPool.address,
                success: true,
            });

            expect(boost.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: userSecond.address,
                success: true,
                body: TonVault.excessesMessage({}),
            });
        });

        it(`should create deposit, boost pool and burn all tokens`, async () => {
            const amount = toNano(100);
            await deposit({
                account: user,
                amountA: amount,
                amountB: amount,
            });
            await deposit({
                account: userSecond,
                amountA: amount,
                amountB: amount,
            });

            const lpWallet2 = blockchain.openContract(
                ShardexPoolJettonWallet.createFromAddress(await shardexPool.getWalletAddress(userSecond.address))
            );

            await lpWallet2.sendBoost(
                userSecond.getSender(),
                toNano('0.2'),
                await lpWallet2.getJettonBalance(),
                userSecond.address
            );

            const lpWallet = blockchain.openContract(
                ShardexPoolJettonWallet.createFromAddress(await shardexPool.getWalletAddress(user.address))
            );

            const burn = await lpWallet.sendBurn(
                user.getSender(),
                toNano('0.2'),
                await lpWallet.getJettonBalance(),
                user.address,
                null
            );

            expect(burn.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: tonVault.address,
                success: true,
                body: JettonWallet.transferMessage(toNano(100 * 2), user.address, user.address, null, BigInt(0), null),
            });
            expect(burn.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletB,
                success: true,
                body: JettonWallet.transferMessage(toNano(100 * 2), user.address, user.address, null, BigInt(0), null),
            });
        });
    });
    describe('Utils', () => {
        it('report correct discovery address - deplouer user', async () => {
            let discoveryResult = await shardexPool.sendDiscovery(deployer.getSender(), deployer.address, true);
            /*
              take_wallet_address#d1735400 query_id:uint64 wallet_address:MsgAddress owner_address:(Maybe ^MsgAddress) = InternalMsgBody;
            */

            const deployerJettonWallet = blockchain.openContract(
                ShardexPoolJettonWallet.createFromAddress(await shardexPool.getWalletAddress(deployer.address))
            );

            findTransactionRequired(discoveryResult.transactions, {
                from: shardexPool.address,
                to: deployer.address,
                body: beginCell()
                    .storeUint(Opcodes.take_wallet_address, 32)
                    .storeUint(0, 64)
                    .storeAddress(deployerJettonWallet.address)
                    .storeUint(1, 1)
                    .storeRef(beginCell().storeAddress(deployer.address).endCell())
                    .endCell(),
            });
        });
        it('report correct discovery address - common user', async () => {
            const discoveryResult = await shardexPool.sendDiscovery(deployer.getSender(), userSecond.address, true);

            const notDeployerJettonWallet = blockchain.openContract(
                ShardexPoolJettonWallet.createFromAddress(await shardexPool.getWalletAddress(userSecond.address))
            );

            expect(discoveryResult.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: deployer.address,
                body: beginCell()
                    .storeUint(Opcodes.take_wallet_address, 32)
                    .storeUint(0, 64)
                    .storeAddress(notDeployerJettonWallet.address)
                    .storeUint(1, 1)
                    .storeRef(beginCell().storeAddress(userSecond.address).endCell())
                    .endCell(),
            });
        });
        it('report correct discovery address - do not include owner address', async () => {
            const discoveryResult = await shardexPool.sendDiscovery(deployer.getSender(), userSecond.address, false);

            const notDeployerJettonWallet = blockchain.openContract(
                ShardexPoolJettonWallet.createFromAddress(await shardexPool.getWalletAddress(userSecond.address))
            );

            expect(discoveryResult.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: deployer.address,
                body: beginCell()
                    .storeUint(Opcodes.take_wallet_address, 32)
                    .storeUint(0, 64)
                    .storeAddress(notDeployerJettonWallet.address)
                    .storeUint(0, 1)
                    .endCell(),
            });
        });
    });
});
