import { compile } from '@ton/blueprint';
import { Address, Cell, beginCell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import BigNumber from 'bignumber.js';
import { JettonMinter, jettonContentToCell } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import { ShardexPool, ShardexTokensData } from '../wrappers/ShardexPool';
import { ShardexPoolJettonWallet } from '../wrappers/ShardexPoolJettonWallet';
import { PoolTokenKind, PoolVersion } from '../wrappers/state';
import { TestJettonsSwaps } from './testUtils';

describe('ShardexJettonsPool', () => {
    let jwallet_code = new Cell();
    let minter_code = new Cell();
    let poolCode: Cell;
    let lpWalletCode: Cell;

    let jettonMinterA: SandboxContract<JettonMinter>;
    let jettonMinterB: SandboxContract<JettonMinter>;
    let userWalletA: SandboxContract<JettonWallet>;
    let userWalletB: SandboxContract<JettonWallet>;

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let user: SandboxContract<TreasuryContract>;
    let userSecond: SandboxContract<TreasuryContract>;

    let shardexPool: SandboxContract<ShardexPool>;

    let jettonWalletA: Address;
    let jettonWalletB: Address;

    let index = 0;

    const jettonTotal = toNano(toNano(toNano(1000)));

    beforeAll(async () => {
        poolCode = await compile('ShardexPool');
        lpWalletCode = await compile('ShardexPoolJettonWallet');

        jwallet_code = await compile('JettonWallet');
        minter_code = await compile('JettonMinter');

        blockchain = await Blockchain.create();

        deployer = await blockchain.treasury('deployer');
        user = await blockchain.treasury('userA');
        userSecond = await blockchain.treasury('userB');

        jettonMinterA = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    admin: deployer.address,
                    jetton_content: jettonContentToCell({ uri: 'https://testjetton.org/content.json' }),
                    wallet_code: jwallet_code,
                },
                minter_code
            )
        );

        await jettonMinterA.sendMint(
            deployer.getSender(),
            user.address,
            jettonTotal,
            null,
            null,
            null,
            toNano('0.05'),
            toNano('1')
        );
        await jettonMinterA.sendMint(
            deployer.getSender(),
            userSecond.address,
            jettonTotal,
            null,
            null,
            null,
            toNano('0.05'),
            toNano('1')
        );
        userWalletA = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinterA.getWalletAddress(user.address))
        );

        jettonMinterB = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    admin: deployer.address,
                    jetton_content: jettonContentToCell({ uri: 'https://testjetton.org/content_2.json' }),
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
                    tokenA: { kind: PoolTokenKind.jetton, address: jettonMinterA.address },
                    tokenB: { kind: PoolTokenKind.jetton, address: jettonMinterB.address },
                    lpWalletCode: lpWalletCode,
                    version: PoolVersion.v0,
                },
                poolCode
            )
        );

        jettonWalletA = await jettonMinterA.getWalletAddress(shardexPool.address);
        jettonWalletB = await jettonMinterB.getWalletAddress(shardexPool.address);

        const deployResult = await shardexPool.sendDeploy(deployer.getSender(), toNano('0.05'), {
            vaultA: jettonWalletA,
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

    it('should deploy', async () => {
        const data = await shardexPool.getPoolData();
        //  console.log(data);
        expect(data.admin).toBeDefined();
    });

    async function swap(opts: {
        account: SandboxContract<TreasuryContract>;
        jettonMinterIn: SandboxContract<JettonMinter>;
        amountIn: bigint;
        slippage?: number;
        responseAddress?: Address;
    }) {
        const jettonWalletIn = JettonWallet.createFromAddress(
            await opts.jettonMinterIn.getWalletAddress(shardexPool.address)
        );

        const before = await shardexPool.getTokensData();

        const amountOut = await shardexPool.getSwapRate({
            vaultIn: jettonWalletIn.address,
            amountIn: opts.amountIn,
        });

        // console.log('amountIn', opts.amountIn.toString(), 'amountOut', amountOut.toString());
        const message = ShardexPool.swapMessage({
            amountOut: amountOut,
            slippage: opts.slippage,
            responseAddress: opts.responseAddress,
        });

        const wallet = blockchain.openContract(
            JettonWallet.createFromAddress(await opts.jettonMinterIn.getWalletAddress(opts.account.address))
        );
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
        return { send };
    }

    function compare(before: ShardexTokensData, after: ShardexTokensData) {
        const kBefore = before.tokenAAmount.multipliedBy(before.tokenBAmount);
        const kAfter = after.tokenAAmount.multipliedBy(after.tokenBAmount);
        expect(kAfter.toNumber()).toBeGreaterThanOrEqual(kBefore.toNumber());
    }

    async function deposit(opts: { account: SandboxContract<TreasuryContract>; amountA: bigint; amountB: bigint }) {
        const message = ShardexPool.depositMessage({
            responseAddress: opts.account.address,
        });

        const walletA = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinterA.getWalletAddress(opts.account.address))
        );
        const sendA = await walletA.sendTransfer(
            opts.account.getSender(),
            toNano('0.2'),
            opts.amountA,
            shardexPool.address,
            opts.account.address,
            null,
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
        return { sendA, sendB };
    }

    async function depositReverse(opts: {
        account: SandboxContract<TreasuryContract>;
        amountA: bigint;
        amountB: bigint;
    }) {
        const message = ShardexPool.depositMessage({
            responseAddress: opts.account.address,
        });

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

        const walletA = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinterA.getWalletAddress(opts.account.address))
        );
        const sendA = await walletA.sendTransfer(
            opts.account.getSender(),
            toNano('0.2'),
            opts.amountA,
            shardexPool.address,
            opts.account.address,
            null,
            toNano('0.1'),
            message
        );

        return { sendA, sendB };
    }

    describe('Deposit', () => {
        for (let { amountA, amountB, lpResult } of [
            { amountA: toNano(10), amountB: toNano(100), lpResult: BigInt(31622776) },
            { amountA: toNano(100), amountB: toNano(10), lpResult: BigInt(31622776) },
            { amountA: toNano(toNano(10)), amountB: toNano(toNano(100)), lpResult: BigInt('31618911698885058') },
        ]) {
            it(`should create  deposit for lp amount ${lpResult.toString()}`, async () => {
                const lpWalletAddress = await shardexPool.getWalletAddress(user.address);
                const { sendA, sendB } = await deposit({
                    account: user,
                    amountA,
                    amountB,
                });

                // send first token and start mint lp jetton
                expect(sendA.transactions).toHaveTransaction({
                    from: user.address,
                    to: userWalletA.address,
                    success: true,
                });
                expect(sendA.transactions).toHaveTransaction({
                    from: userWalletA.address,
                    to: jettonWalletA,
                    success: true,
                });

                expect(sendA.transactions).toHaveTransaction({
                    from: jettonWalletA,
                    to: shardexPool.address,
                    success: true,
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

            it(`should create reverse deposit for lp amount ${lpResult.toString()}`, async () => {
                const lpWalletAddress = await shardexPool.getWalletAddress(user.address);
                const { sendA, sendB } = await depositReverse({
                    account: user,
                    amountA,
                    amountB,
                });

                // send first token and start mint lp jetton
                expect(sendA.transactions).toHaveTransaction({
                    from: user.address,
                    to: userWalletA.address,
                    success: true,
                });
                expect(sendA.transactions).toHaveTransaction({
                    from: userWalletA.address,
                    to: jettonWalletA,
                    success: true,
                });

                expect(sendA.transactions).toHaveTransaction({
                    from: jettonWalletA,
                    to: shardexPool.address,
                    success: true,
                });

                expect(sendA.transactions).toHaveTransaction({
                    from: shardexPool.address,
                    to: lpWalletAddress,
                    success: true,
                });
                expect(sendA.transactions).toHaveTransaction({
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
                expect(sendA.transactions).toHaveTransaction({
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
                    deploy: true,
                });

                expect(sendB.transactions).toHaveTransaction({
                    from: lpWalletAddress,
                    to: user.address,
                    success: true,
                });

                const data = await shardexPool.getTokensData();
                // console.log(data);
                expect(data.tokenAAmount.toString()).toBe(amountA.toString());
                expect(data.tokenBAmount.toString()).toBe(amountB.toString());

                const lpWallet = blockchain.openContract(ShardexPoolJettonWallet.createFromAddress(lpWalletAddress));

                const balance = await lpWallet.getJettonBalance();
                expect(balance.toString()).toBe(lpResult.toString());
            });
        }

        for (let { u1, u2, total } of [
            {
                u1: { amountA: toNano(10), amountB: toNano(100), balance: BigInt(31622776) },
                u2: {
                    amountA: toNano(10),
                    amountB: toNano(100),
                    balance: BigInt(31622776),
                },
                total: { amountA: toNano(20), amountB: toNano(200) },
            },
            {
                u1: {
                    amountA: toNano(33),
                    amountB: toNano(33),
                    balance: BigInt(33000000),
                },
                u2: { amountA: toNano(25), amountB: toNano(25), balance: BigInt(25000000) },
                total: { amountA: toNano(58), amountB: toNano(58) },
            },
            {
                u1: { amountA: toNano(10), amountB: toNano(100), balance: BigInt(31622776) },
                u2: {
                    amountA: toNano(20),
                    amountB: toNano(200),
                    balance: BigInt(63245552),
                },
                total: { amountA: toNano(30), amountB: toNano(300) },
            },
            {
                u1: { amountA: toNano(25), amountB: toNano(25), balance: BigInt(25000000) },
                u2: {
                    amountA: toNano(33),
                    amountB: toNano(33),
                    balance: BigInt(33000000),
                },
                total: { amountA: toNano(58), amountB: toNano(58) },
            },
        ]) {
            it(`should create 2 deposit with connect lp token balance ${total.amountA}`, async () => {
                await deposit({ account: user, amountA: u1.amountA, amountB: u1.amountB });
                await deposit({ account: userSecond, amountA: u2.amountA, amountB: u2.amountB });

                const data = await shardexPool.getTokensData();
                expect(data.tokenAAmount.toString()).toBe(total.amountA.toString());
                expect(data.tokenBAmount.toString()).toBe(total.amountB.toString());

                const lpWalletAddress = await shardexPool.getWalletAddress(user.address);

                const lpWallet = blockchain.openContract(ShardexPoolJettonWallet.createFromAddress(lpWalletAddress));
                const balance = await lpWallet.getJettonBalance();
                // console.log('balance', balance.toString());
                expect(balance.toString()).toBe(u1.balance.toString());

                const secondLpWalletAddress = await shardexPool.getWalletAddress(userSecond.address);

                const secondLpWallet = blockchain.openContract(
                    ShardexPoolJettonWallet.createFromAddress(secondLpWalletAddress)
                );
                const secondBalance = await secondLpWallet.getJettonBalance();
                expect(secondBalance.toString()).toBe(u2.balance.toString());
            });
        }
    });
    describe('Swap', () => {
        for (let { amountA, amountB, amountIn } of TestJettonsSwaps) {
            it(`should swap tokens A ${amountIn.toString()}`, async () => {
                await deposit({ account: user, amountA, amountB });

                const { send } = await swap({
                    account: userSecond,
                    jettonMinterIn: jettonMinterA,
                    amountIn,
                });

                const userWalletA = blockchain.openContract(
                    JettonWallet.createFromAddress(await jettonMinterA.getWalletAddress(userSecond.address))
                );
                const userWalletB = blockchain.openContract(
                    JettonWallet.createFromAddress(await jettonMinterB.getWalletAddress(userSecond.address))
                );

                expect(send.transactions).toHaveTransaction({
                    from: userWalletA.address,
                    to: jettonWalletA,
                    success: true,
                });
                expect(send.transactions).toHaveTransaction({
                    from: jettonWalletA,
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

            it(`should swap tokens B ${amountIn.toString()}`, async () => {
                await deposit({ account: user, amountA, amountB });

                const { send } = await swap({
                    account: userSecond,
                    jettonMinterIn: jettonMinterB,
                    amountIn,
                    slippage: 10,
                });

                const userWalletA = blockchain.openContract(
                    JettonWallet.createFromAddress(await jettonMinterA.getWalletAddress(userSecond.address))
                );
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
                    to: jettonWalletA,
                    success: true,
                });
                expect(send.transactions).toHaveTransaction({
                    from: jettonWalletA,
                    to: userWalletA.address,
                    success: true,
                });
            });
        }

        it(`return tokens by price change`, async () => {
            const amountA = toNano(randomIntFromInterval(1, 1000));
            const amountB = toNano(randomIntFromInterval(1, 1000));
            const amountIn = BigInt(randomIntFromInterval(1000, 2000000000));

            await deposit({ account: user, amountA, amountB });

            const jettonWalletIn = JettonWallet.createFromAddress(
                await jettonMinterB.getWalletAddress(shardexPool.address)
            );

            const amountOut = await shardexPool.getSwapRate({
                vaultIn: jettonWalletIn.address,
                amountIn: amountIn,
            });

            // console.log('amountIn', opts.amountIn.toString(), 'amountOut', amountOut.toString());
            const message = ShardexPool.swapMessage({
                amountOut: BigInt(new BigNumber(amountOut.toString()).multipliedBy(1.5).toFixed(0)),
                slippage: 1,
            });

            const userWalletB = blockchain.openContract(
                JettonWallet.createFromAddress(await jettonMinterB.getWalletAddress(userSecond.address))
            );
            const send = await userWalletB.sendTransfer(
                userSecond.getSender(),
                toNano('0.1'),
                amountIn,
                shardexPool.address,
                userSecond.address,
                null,
                toNano('0.05'),
                message
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
                to: jettonWalletB,
                success: true,
            });
            expect(send.transactions).toHaveTransaction({
                from: jettonWalletB,
                to: userWalletB.address,
                success: true,
            });
        });

        it(`return tokens to fallback by price change`, async () => {
            const amountA = toNano(randomIntFromInterval(1, 1000));
            const amountB = toNano(randomIntFromInterval(1, 1000));
            const amountIn = BigInt(randomIntFromInterval(1000, 2000000000));

            const userThree = await blockchain.treasury('userC');

            await deposit({ account: user, amountA, amountB });

            const jettonWalletIn = JettonWallet.createFromAddress(
                await jettonMinterB.getWalletAddress(shardexPool.address)
            );

            const amountOut = await shardexPool.getSwapRate({
                vaultIn: jettonWalletIn.address,
                amountIn: amountIn,
            });

            // console.log('amountIn', opts.amountIn.toString(), 'amountOut', amountOut.toString());
            const message = ShardexPool.swapMessage({
                amountOut: BigInt(new BigNumber(amountOut.toString()).multipliedBy(1.5).toFixed(0)),
                slippage: 1,
                toAddress: userThree.address,
                responseAddress: userThree.address,
                fallbackAddress: userThree.address,
            });

            const userWalletB = blockchain.openContract(
                JettonWallet.createFromAddress(await jettonMinterB.getWalletAddress(userSecond.address))
            );
            const send = await userWalletB.sendTransfer(
                userSecond.getSender(),
                toNano('0.1'),
                amountIn,
                shardexPool.address,
                userSecond.address,
                null,
                toNano('0.05'),
                message
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

            const userWalletC = blockchain.openContract(
                JettonWallet.createFromAddress(await jettonMinterB.getWalletAddress(userThree.address))
            );

            expect(send.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletB,
                success: true,
            });
            expect(send.transactions).toHaveTransaction({
                from: jettonWalletB,
                to: userWalletC.address,
                success: true,
            });
        });
    });

    describe('Swap exact out', () => {
        for (let { value, amount } of [
            { value: toNano('1'), amount: BigInt(1000) },
            {
                value: toNano(randomIntFromInterval(1, 1000)),
                amount: BigInt(randomIntFromInterval(1000, 2000000000)),
            },
            {
                value: toNano(toNano(randomIntFromInterval(1, 1000))),
                amount: toNano(BigInt(randomIntFromInterval(1000, 2000000000))),
            },
        ]) {
            it(`should calculate exact out swap tokens B ${amount.toString()}`, async () => {
                await deposit({ account: user, amountA: value, amountB: value });

                const jettonWalletIn = JettonWallet.createFromAddress(
                    await jettonMinterB.getWalletAddress(shardexPool.address)
                );

                const amountOut = await shardexPool.getSwapRate({
                    vaultIn: jettonWalletIn.address,
                    amountIn: amount,
                });

                const amountIn = await shardexPool.getExactOutSwapRate({
                    vaultIn: jettonWalletIn.address,
                    amountOut: amount,
                });

                const a = new BigNumber(amount.toString());
                expect(a.isGreaterThan(new BigNumber(amountOut.toString()))).toBeTruthy();
                expect(a.isLessThan(new BigNumber(amountIn.toString()))).toBeTruthy();
            });

            it(`should calculate exact out swap tokens A ${amount.toString()}`, async () => {
                await deposit({ account: user, amountA: value, amountB: value });

                const jettonWalletIn = JettonWallet.createFromAddress(
                    await jettonMinterA.getWalletAddress(shardexPool.address)
                );

                const amountOut = await shardexPool.getSwapRate({
                    vaultIn: jettonWalletIn.address,
                    amountIn: amount,
                });

                const amountIn = await shardexPool.getExactOutSwapRate({
                    vaultIn: jettonWalletIn.address,
                    amountOut: amount,
                });

                const a = new BigNumber(amount.toString());
                expect(a.isGreaterThan(new BigNumber(amountOut.toString()))).toBeTruthy();
                expect(a.isLessThan(new BigNumber(amountIn.toString()))).toBeTruthy();
            });
        }

        for (let { amountA, amountB, amount } of [
            { amountA: toNano('10'), amountB: toNano('10'), amount: toNano('1') },
            { amountA: toNano('10'), amountB: toNano('20'), amount: toNano('1') },
            { amountA: toNano('20'), amountB: toNano('10'), amount: toNano('1') },
            { amountA: toNano('100'), amountB: toNano('100'), amount: toNano('1') },
            { amountA: toNano('100'), amountB: toNano('200'), amount: toNano('1') },
            { amountA: toNano('200'), amountB: toNano('100'), amount: toNano('1') },
        ]) {
            it(`should exact out swap tokens A ${amountA.toString()} ${amountB.toString()} ${amount.toString()}`, async () => {
                await deposit({ account: user, amountA, amountB });

                const jettonWalletIn = JettonWallet.createFromAddress(
                    await jettonMinterB.getWalletAddress(shardexPool.address)
                );

                const amountOut = amount;

                const amountIn = await shardexPool.getExactOutSwapRate({
                    vaultIn: jettonWalletIn.address,
                    amountOut: amountOut,
                    extra: 10, // 1%
                });

                // console.log('amountIn', amountIn.toString(), 'amountOut', amountOut.toString());

                const message = ShardexPool.swapMessage({
                    amountOut: amountOut,
                    exactOut: true,
                });

                const userWalletB = blockchain.openContract(
                    JettonWallet.createFromAddress(await jettonMinterB.getWalletAddress(userSecond.address))
                );
                const userWalletA = blockchain.openContract(
                    JettonWallet.createFromAddress(await jettonMinterA.getWalletAddress(userSecond.address))
                );
                const send = await userWalletB.sendTransfer(
                    userSecond.getSender(),
                    toNano('0.1'),
                    amountIn,
                    shardexPool.address,
                    userSecond.address,
                    null,
                    toNano('0.05'),
                    message
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
                    to: jettonWalletA,
                    success: true,
                    body: JettonWallet.transferMessage(amountOut, userSecond.address, null, null, BigInt(1), null),
                });

                expect(send.transactions).toHaveTransaction({
                    from: jettonWalletA,
                    to: userWalletA.address,
                    success: true,
                });

                expect(send.transactions).toHaveTransaction({
                    from: userWalletA.address,
                    to: userSecond.address,
                });
            });
        }
    });
    describe('Withdraw', () => {
        it(`should withdraw tokens after swap`, async () => {
            await deposit({ account: user, amountA: BigInt(1000), amountB: BigInt(1000) });
            await swap({ account: userSecond, jettonMinterIn: jettonMinterA, amountIn: BigInt(100) });

            const lpWallet = blockchain.openContract(
                JettonWallet.createFromAddress(await shardexPool.getWalletAddress(user.address))
            );

            const burn = await lpWallet.sendBurn(user.getSender(), toNano('0.2'), await lpWallet.getJettonBalance());

            expect(burn.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletA,
                success: true,
            });
            expect(burn.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletB,
                success: true,
            });

            const dataAfter2 = await shardexPool.getTokensData();
            expect(dataAfter2.tokenAAmount.toString()).toBe(BigInt(0).toString());
            expect(dataAfter2.tokenBAmount.toString()).toBe(BigInt(0).toString());
        });

        it(`should withdraw tokens for 2 users`, async () => {
            await deposit({ account: user, amountA: BigInt(300), amountB: BigInt(500) });
            await deposit({ account: userSecond, amountA: BigInt(600), amountB: BigInt(1000) });

            const lpWallet = blockchain.openContract(
                JettonWallet.createFromAddress(await shardexPool.getWalletAddress(user.address))
            );
            const burn = await lpWallet.sendBurn(user.getSender(), toNano('0.2'), await lpWallet.getJettonBalance());

            expect(burn.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletA,
                success: true,
                // body: JettonWallet.transferMessage(BigInt(300), user.address, null, null, BigInt(0), null),
            });
            expect(burn.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletB,
                success: true,
                // body: JettonWallet.transferMessage(BigInt(500), user.address, null, null, BigInt(0), null),
            });

            const lpSecondWallet = blockchain.openContract(
                JettonWallet.createFromAddress(await shardexPool.getWalletAddress(userSecond.address))
            );

            const secondBurn = await lpSecondWallet.sendBurn(
                userSecond.getSender(),
                toNano('0.2'),
                await lpSecondWallet.getJettonBalance()
            );

            expect(secondBurn.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletA,
                success: true,
                // body: JettonWallet.transferMessage(BigInt(600), userSecond.address, null, null, BigInt(0), null),
            });
            expect(secondBurn.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletB,
                success: true,
                // body: JettonWallet.transferMessage(BigInt(1000), userSecond.address, null, null, BigInt(0), null),
            });

            const dataAfter2 = await shardexPool.getTokensData();
            expect(dataAfter2.tokenAAmount.toString()).toBe(BigInt(0).toString());
            expect(dataAfter2.tokenBAmount.toString()).toBe(BigInt(0).toString());
        });

        it(`should withdraw tokens by 2 operations`, async () => {
            await deposit({ account: user, amountA: BigInt(1000), amountB: BigInt(100000) });

            const lpWallet = blockchain.openContract(
                JettonWallet.createFromAddress(await shardexPool.getWalletAddress(user.address))
            );

            const before = await lpWallet.getJettonBalance();
            expect(before.toString()).toBe(BigInt(10).toString());

            const burn = await lpWallet.sendBurn(user.getSender(), toNano('0.2'), BigInt(7));

            expect(burn.transactions).toHaveTransaction({
                from: user.address,
                to: lpWallet.address,
                success: true,
                body: JettonWallet.burnMessage(BigInt(7)),
            });
            expect(burn.transactions).toHaveTransaction({
                from: lpWallet.address,
                to: shardexPool.address,
                success: true,
            });
            expect(burn.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletA,
                success: true,
                body: JettonWallet.transferMessage(BigInt(700), user.address, null, null, BigInt(0), null),
            });
            expect(burn.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletB,
                success: true,
                body: JettonWallet.transferMessage(BigInt(70000), user.address, null, null, BigInt(0), null),
            });

            const after = await lpWallet.getJettonBalance();
            expect(after.toString()).toBe(BigInt(3).toString());

            const dataAfter = await shardexPool.getTokensData();
            expect(dataAfter.tokenAAmount.toString()).toBe(BigInt(300).toString());
            expect(dataAfter.tokenBAmount.toString()).toBe(BigInt(30000).toString());

            const burn2 = await lpWallet.sendBurn(user.getSender(), toNano('0.2'), BigInt(3), user.address);

            expect(burn2.transactions).toHaveTransaction({
                from: lpWallet.address,
                to: shardexPool.address,
                success: true,
            });
            expect(burn2.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletA,
                success: true,
                body: JettonWallet.transferMessage(BigInt(300), user.address, user.address, null, BigInt(0), null),
            });
            expect(burn2.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletB,
                success: true,
                body: JettonWallet.transferMessage(BigInt(30000), user.address, user.address, null, BigInt(0), null),
            });
            expect(burn2.transactions).toHaveTransaction({
                from: jettonWalletA,
                to: userWalletA.address,
                success: true,
            });
            expect(burn2.transactions).toHaveTransaction({
                from: jettonWalletB,
                to: userWalletB.address,
                success: true,
            });

            const after2 = await lpWallet.getJettonBalance();
            expect(after2.toString()).toBe(BigInt(0).toString());

            const dataAfter2 = await shardexPool.getTokensData();
            expect(dataAfter2.tokenAAmount.toString()).toBe(BigInt(0).toString());
            expect(dataAfter2.tokenBAmount.toString()).toBe(BigInt(0).toString());
        });
    });

    describe('Admin', () => {
        it(`should update content`, async () => {
            const content = jettonContentToCell({ uri: 'https://testjetton.org/content.json' });
            const send = await shardexPool.sendUpdateContent(deployer.getSender(), { value: toNano('0.1'), content });

            expect(send.transactions).toHaveTransaction({
                from: deployer.address,
                to: shardexPool.address,
                success: true,
            });

            const data = await shardexPool.getJettonData();
            expect(data.content.toString()).toBe(content.toString());
        });
        it(`should not update content because of sender`, async () => {
            const content = jettonContentToCell({ uri: 'https://testjetton.org/content.json' });
            const send = await shardexPool.sendUpdateContent(user.getSender(), { value: toNano('0.1'), content });

            expect(send.transactions).toHaveTransaction({
                from: user.address,
                to: shardexPool.address,
                success: false,
                exitCode: 73,
            });
        });
        it(`should update admin`, async () => {
            const send = await shardexPool.sendUpdateAdmin(deployer.getSender(), {
                value: toNano('0.1'),
                address: user.address,
            });

            expect(send.transactions).toHaveTransaction({
                from: deployer.address,
                to: shardexPool.address,
                success: true,
            });

            const data = await shardexPool.getJettonData();
            expect(data.adminAddress.toString()).toBe(user.address.toString());
        });

        it(`should not update admin because of sender`, async () => {
            const send = await shardexPool.sendUpdateAdmin(user.getSender(), {
                value: toNano('0.1'),
                address: user.address,
            });

            expect(send.transactions).toHaveTransaction({
                from: user.address,
                to: shardexPool.address,
                success: false,
                exitCode: 73,
            });
        });

        it(`should update fee twice`, async () => {
            const send = await shardexPool.sendUpdateFee(deployer.getSender(), {
                value: toNano('0.1'),
                fee: BigInt(100),
            });

            expect(send.transactions).toHaveTransaction({
                from: deployer.address,
                to: shardexPool.address,
                success: true,
            });

            const data = await shardexPool.getPoolData();
            expect(data.fee).toBe(100);

            const send2 = await shardexPool.sendUpdateFee(deployer.getSender(), {
                value: toNano('0.1'),
                fee: BigInt(40),
            });

            expect(send2.transactions).toHaveTransaction({
                from: deployer.address,
                to: shardexPool.address,
                success: true,
            });

            const data2 = await shardexPool.getPoolData();
            expect(data2.fee).toBe(40);
        });

        it(`should not withdraw fee because fee is empty`, async () => {
            await deposit({ account: user, amountA: toNano(10), amountB: toNano(10) });
            const send = await shardexPool.sendWithdrawFee(deployer.getSender(), {
                value: toNano('0.5'),
            });
            expect(send.transactions).toHaveTransaction({
                from: deployer.address,
                to: shardexPool.address,
                success: false,
                exitCode: 752,
            });
        });

        it(`should not withdraw fee because of sender`, async () => {
            await deposit({ account: user, amountA: toNano(10), amountB: toNano(10) });
            const send = await shardexPool.sendWithdrawFee(user.getSender(), {
                value: toNano('0.5'),
            });
            expect(send.transactions).toHaveTransaction({
                from: user.address,
                to: shardexPool.address,
                success: false,
                exitCode: 73,
            });
        });

        it(`should withdraw fee`, async () => {
            await deposit({ account: user, amountA: toNano(10), amountB: toNano(10) });
            await swap({
                account: userSecond,
                jettonMinterIn: jettonMinterB,
                amountIn: toNano('0.5'),
            });
            await swap({
                account: userSecond,
                jettonMinterIn: jettonMinterA,
                amountIn: toNano('0.3'),
            });

            const before = await shardexPool.getTokensData();

            const send = await shardexPool.sendWithdrawFee(deployer.getSender(), {
                value: toNano('0.5'),
            });

            expect(send.transactions).toHaveTransaction({
                from: deployer.address,
                to: shardexPool.address,
                success: true,
            });

            expect(send.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletA,
                success: true,
                body: JettonWallet.transferMessage(
                    BigInt(before.feeAAmount.toString()),
                    deployer.address,
                    deployer.address,
                    null,
                    BigInt(0),
                    null
                ),
            });

            expect(send.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletB,
                success: true,
                body: JettonWallet.transferMessage(
                    BigInt(before.feeBAmount.toString()),
                    deployer.address,
                    deployer.address,
                    null,
                    BigInt(0),
                    null
                ),
            });

            const data = await shardexPool.getTokensData();
            expect(data.feeAAmount.toString()).toBe('0');
            expect(data.feeBAmount.toString()).toBe('0');
        });
        it(`should not force withdraw user tokens because if sender`, async () => {
            await deposit({ account: user, amountA: toNano(1), amountB: toNano(1) });

            const send = await shardexPool.sendForceWithdraw(user.getSender(), {
                value: toNano('0.5'),
                user: user.address,
            });

            expect(send.transactions).toHaveTransaction({
                from: user.address,
                to: shardexPool.address,
                success: false,
                exitCode: 73,
            });
        });

        it(`should force withdraw user tokens`, async () => {
            await deposit({ account: user, amountA: toNano(1), amountB: toNano(1) });

            const before = await shardexPool.getJettonData();
            expect(before.totalSupply.toString()).toBe('1000000');

            const send = await shardexPool.sendForceWithdraw(deployer.getSender(), {
                value: toNano('0.5'),
                user: user.address,
            });

            const lpWalletAddress = await shardexPool.getWalletAddress(user.address);

            expect(send.transactions).toHaveTransaction({
                from: deployer.address,
                to: shardexPool.address,
                success: true,
            });

            expect(send.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: lpWalletAddress,
                success: true,
                destroyed: true,
            });
            expect(send.transactions).toHaveTransaction({
                from: lpWalletAddress,
                to: shardexPool.address,
                success: true,
            });
            expect(send.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletA,
                success: true,
                body: JettonWallet.transferMessage(toNano(1), user.address, null, null, BigInt(0), null),
            });
            expect(send.transactions).toHaveTransaction({
                from: shardexPool.address,
                to: jettonWalletB,
                success: true,
                body: JettonWallet.transferMessage(toNano(1), user.address, null, null, BigInt(0), null),
            });

            const after = await shardexPool.getJettonData();
            expect(after.totalSupply.toString()).toBe('0');
        });
    });
});

function randomIntFromInterval(min: number, max: number) {
    // min and max included
    return Math.floor(Math.random() * (max - min + 1) + min);
}
