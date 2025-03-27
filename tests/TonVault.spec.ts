import { compile } from '@ton/blueprint';
import { Cell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import { findTransactionRequired } from '@ton/test-utils';
import { GasPrices, getGasPrices, getMsgPrices, getStoragePrices, MsgPrices, StorageValue } from '../wrappers/gasUtils';
import { TonVault } from '../wrappers/TonVault';

describe('TonVault', () => {
    let vaultCode = new Cell();
    let blockchain: Blockchain;
    let owner: SandboxContract<TreasuryContract>;
    let notOwner: SandboxContract<TreasuryContract>;
    let vaultMinter: SandboxContract<TonVault>;
    let msgPrices: MsgPrices;
    let gasPrices: GasPrices;
    let storagePrices: StorageValue;

    let index = 0;

    beforeAll(async () => {
        vaultCode = await compile('TonVault');
        blockchain = await Blockchain.create();

        blockchain.now = Math.floor(Date.now() / 1000);

        notOwner = await blockchain.treasury('notDeployer');

        msgPrices = getMsgPrices(blockchain.config, 0);
        gasPrices = getGasPrices(blockchain.config, 0);
        storagePrices = getStoragePrices(blockchain.config);
    });

    beforeEach(async () => {
        owner = await blockchain.treasury(`deployer${++index}`);
        vaultMinter = blockchain.openContract(
            TonVault.createFromConfig(
                {
                    owner: owner.address,
                },
                vaultCode
            )
        );
    });

    // implementation detail
    it('should deploy by owner', async () => {
        const deployResult = await vaultMinter.sendDeposit(
            owner.getSender(),
            toNano('10.2'),
            toNano('10'),
            owner.address,
            toNano('0.1'),
            null
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: owner.address,
            to: vaultMinter.address,
            deploy: true,
            inMessageBounced: false,
        });

        expect(deployResult.transactions).toHaveTransaction({
            from: vaultMinter.address,
            to: owner.address,
            success: true,
            value: toNano(0.1),
            body: TonVault.transferNotificationMessage({
                tokenAmount: toNano('10'),
                owner: owner.address,
                forwardPayload: null,
            }),
        });

        expect(deployResult.transactions).toHaveTransaction({
            from: vaultMinter.address,
            to: owner.address,
            success: true,
            body: TonVault.excessesMessage({}),
        });

        const transferTx = findTransactionRequired(deployResult.transactions, {
            on: vaultMinter.address,
            from: owner.address,
            deploy: true,
        });
    });

    it('should deploy by owner without notification', async () => {
        const deployResult = await vaultMinter.sendDeposit(
            owner.getSender(),
            toNano('10.2'),
            toNano('10'),
            owner.address,
            toNano('0'),
            null
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: owner.address,
            to: vaultMinter.address,
            deploy: true,
            inMessageBounced: false,
        });

        expect(deployResult.transactions).toHaveTransaction({
            from: vaultMinter.address,
            to: owner.address,
            success: true,
            body: TonVault.excessesMessage({}),
        });
    });

    it('should deploy and bounce because of invalid amount', async () => {
        let tonAmount = toNano('10');
        let forwardAmount = 1n;

        const deployResult = await vaultMinter.sendDeposit(
            owner.getSender(),
            tonAmount + 1n,
            tonAmount,
            owner.address,
            forwardAmount,
            null
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: owner.address,
            to: vaultMinter.address,
            deploy: true,
            inMessageBounceable: true,
            exitCode: 47,
        });

        expect(deployResult.transactions).toHaveTransaction({
            from: vaultMinter.address,
            to: owner.address,
            inMessageBounced: true,
        });
    });

    it('should deploy by not owner', async () => {
        const deployResult = await vaultMinter.sendDeposit(
            notOwner.getSender(),
            toNano('10.2'),
            toNano('10'),
            notOwner.address,
            toNano('0.1'),
            null
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: notOwner.address,
            to: vaultMinter.address,
            deploy: true,
            inMessageBounced: false,
        });

        expect(deployResult.transactions).toHaveTransaction({
            from: vaultMinter.address,
            to: owner.address,
            success: true,
            value: toNano(0.1),
            body: TonVault.transferNotificationMessage({
                tokenAmount: toNano('10'),
                owner: notOwner.address,
                forwardPayload: null,
            }),
        });

        expect(deployResult.transactions).toHaveTransaction({
            from: vaultMinter.address,
            to: notOwner.address,
            success: true,
            body: TonVault.excessesMessage({}),
        });
    });

    it('should verify data and balance', async () => {
        const deployResult = await vaultMinter.sendDeposit(
            owner.getSender(),
            toNano('10.2'),
            toNano('10'),
            owner.address,
            toNano('0.1'),
            null
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: owner.address,
            to: vaultMinter.address,
            deploy: true,
            inMessageBounced: false,
        });

        const data = await vaultMinter.getVaultData();
        expect(data.balance.toString()).toBe(toNano('10').toString());
        expect(data.owner.toString()).toBe(owner.address.toString());

        const state = await vaultMinter.getState();
        expect(state.balance.toString()).toBe(toNano('10').toString());
    });

    it('should verify data and balance after 2 deposit', async () => {
        await vaultMinter.sendDeposit(
            owner.getSender(),
            toNano('10.2'),
            toNano('10'),
            owner.address,
            toNano('0.1'),
            null
        );

        await vaultMinter.sendDeposit(owner.getSender(), toNano('5.1'), toNano('5'), owner.address, toNano('0'), null);

        const data = await vaultMinter.getVaultData();
        expect(data.balance.toString()).toBe(toNano('15').toString());

        const state = await vaultMinter.getState();
        expect(state.balance.toString()).toBe(toNano('15').toString());
    });

    it('should transfer asset to another wallet', async () => {
        await vaultMinter.sendDeposit(
            owner.getSender(),
            toNano('10.2'),
            toNano('10'),
            owner.address,
            toNano('0.1'),
            null
        );

        const value = toNano(5);

        const transferResult = await vaultMinter.sendTransfer(
            owner.getSender(),
            toNano(0.1),
            value,
            notOwner.address,
            owner.address,
            null
        );

        expect(transferResult.transactions).toHaveTransaction({
            from: owner.address,
            to: vaultMinter.address,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: vaultMinter.address,
            to: notOwner.address,
            success: true,
            value,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: vaultMinter.address,
            to: owner.address,
            success: true,
            body: TonVault.excessesMessage({}),
        });

        const data = await vaultMinter.getVaultData();
        expect(data.balance.toString()).toBe(toNano('5').toString());

        const state = await vaultMinter.getState();
        expect(state.balance.toString()).toBe(toNano('5').toString());
    });

    it('should create 2 transfers to another wallet', async () => {
        await vaultMinter.sendDeposit(
            owner.getSender(),
            toNano('10.2'),
            toNano('10'),
            owner.address,
            toNano('0.1'),
            null
        );

        const value = toNano(3);

        await vaultMinter.sendTransfer(owner.getSender(), toNano(0.1), value, notOwner.address, owner.address, null);

        const transferResult = await vaultMinter.sendTransfer(
            owner.getSender(),
            toNano(0.1),
            value,
            notOwner.address,
            owner.address,
            null
        );

        expect(transferResult.transactions).toHaveTransaction({
            from: owner.address,
            to: vaultMinter.address,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: vaultMinter.address,
            to: notOwner.address,
            success: true,
            value,
            body: new Cell(),
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: vaultMinter.address,
            to: owner.address,
            success: true,
            body: TonVault.excessesMessage({}),
        });

        const data = await vaultMinter.getVaultData();
        expect(data.balance.toString()).toBe(toNano('4').toString());

        const state = await vaultMinter.getState();
        expect(state.balance.toString()).toBe(toNano('4').toString());
    });
});
