import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    toNano,
} from '@ton/core';
import BigNumber from 'bignumber.js';
import { loadPool, poolConfigToCell, ShardexPoolConfig, ShardexPoolData } from './state';

export type ShardexTokensData = {
    tokenA: Address;
    tokenAAmount: BigNumber;
    feeAAmount: BigNumber;
    tokenB: Address;
    tokenBAmount: BigNumber;
    feeBAmount: BigNumber;
};

export type ShardexJettonData = {
    totalSupply: BigNumber;
    mintable: boolean;
    adminAddress: Address;
    content: Cell;
    walletCode: Cell;
};

export const Opcodes = {
    deposit: 0xf8707162,
    depositNotification: 0xc9f62873,
    swap: 0x6f262702,
    internalTransfer: 0x178d4519,
    admin: 0x5cff8836,
    providePoolRate: 0x5d35428,
    takePoolRate: 0xf0e5b4c6,
    transferNotification: 0x7362d09c,
    boostBotification: 0xd20f2256,
    provide_wallet_address: 0x2c76b973,
    take_wallet_address: 0xd1735400,
};

export const AdminOpCodes = {
    updateContent: 0x379bcebd,
    updateAdmin: 0x3e7e48c5,
    updateFee: 0x92081e6a,
    withdrawFee: 0x93f98af6,
    forceWithdraw: 0x49567be8,
};

export const ct_fee_divider = 10000;

export class ShardexPool implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new ShardexPool(address);
    }

    static createFromConfig(config: ShardexPoolConfig, code: Cell, workchain = 0) {
        const data = poolConfigToCell(config);
        const init = { code, data };
        return new ShardexPool(contractAddress(workchain, init), init);
    }
    static deployMessage(opts: { vaultA: Address; vaultB: Address; fee: number; protocolFee?: number; content: Cell }) {
        return beginCell()
            .storeAddress(opts.vaultA)
            .storeAddress(opts.vaultB)
            .storeUint(opts.fee, 8)
            .storeUint(opts.protocolFee ?? 10, 8)
            .storeRef(opts.content)
            .endCell();
    }

    async sendDeploy(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        opts: {
            vaultA: Address;
            vaultB: Address;
            fee: number;
            protocolFee?: number;
            content: Cell;
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: ShardexPool.deployMessage(opts),
        });
    }

    static depositNotificationMessage(opts: {
        queryID?: number;
        amountA: bigint;
        amountB: bigint;
        owner: Address;
        responseAddress?: Address;
    }) {
        return beginCell()
            .storeUint(Opcodes.depositNotification, 32)
            .storeUint(opts.queryID ?? 0, 64)
            .storeCoins(opts.amountA)
            .storeCoins(opts.amountB)
            .storeAddress(opts.owner)
            .storeAddress(opts.responseAddress)
            .endCell();
    }

    static swapMessage(opts: {
        amountOut: bigint;
        slippage?: number;
        customFee?: number;
        toAddress?: Address;
        responseAddress?: Address; // Response addr
        fallbackAddress?: Address;
        customPayload?: Cell;
        forwardTonAmount?: bigint;
        forwardPayload?: Cell;
        exactOut?: boolean;
    }) {
        const swapMsg = beginCell()
            .storeUint(Opcodes.swap, 32)
            .storeCoins(opts.amountOut)
            .storeBit(opts.exactOut ?? false)
            .storeUint(opts.slippage ?? 10, 10)
            .storeUint(opts.customFee ?? 0, 8)
            .storeAddress(opts.toAddress)
            .storeRef(beginCell().storeAddress(opts.responseAddress).storeAddress(opts.fallbackAddress).endCell())
            .storeMaybeRef(opts.customPayload ?? null)
            .storeCoins(opts.forwardTonAmount ?? BigInt(1))
            .storeMaybeRef(opts.forwardPayload ?? null)
            .endCell();

        return swapMsg;
    }

    static depositMessage(opts: { responseAddress: Address }) {
        return beginCell().storeUint(Opcodes.deposit, 32).storeAddress(opts.responseAddress).endCell();
    }

    async sendUpdateContent(
        provider: ContractProvider,
        via: Sender,
        opts: {
            content: Cell;
            value: bigint;
            queryID?: number;
        }
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.admin, 32)
                .storeUint(opts.queryID ?? 0, 64)
                .storeUint(AdminOpCodes.updateContent, 32)
                .storeRef(opts.content)
                .endCell(),
        });
    }

    async sendUpdateAdmin(
        provider: ContractProvider,
        via: Sender,
        opts: {
            address: Address;
            value: bigint;
            queryID?: number;
        }
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.admin, 32)
                .storeUint(opts.queryID ?? 0, 64)
                .storeUint(AdminOpCodes.updateAdmin, 32)
                .storeAddress(opts.address)
                .endCell(),
        });
    }

    async sendUpdateFee(
        provider: ContractProvider,
        via: Sender,
        opts: {
            fee: bigint;
            protocolFee?: bigint;
            value: bigint;
            queryID?: number;
        }
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.admin, 32)
                .storeUint(opts.queryID ?? 0, 64)
                .storeUint(AdminOpCodes.updateFee, 32)
                .storeUint(opts.fee, 8)
                .storeUint(opts.protocolFee ?? 10, 8)
                .endCell(),
        });
    }

    async sendWithdrawFee(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: bigint;
            queryID?: number;
        }
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.admin, 32)
                .storeUint(opts.queryID ?? 0, 64)
                .storeUint(AdminOpCodes.withdrawFee, 32)
                .endCell(),
        });
    }

    async sendForceWithdraw(
        provider: ContractProvider,
        via: Sender,
        opts: {
            user: Address;
            value: bigint;
            queryID?: number;
        }
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.admin, 32)
                .storeUint(opts.queryID ?? 0, 64)
                .storeUint(AdminOpCodes.forceWithdraw, 32)
                .storeAddress(opts.user)
                .endCell(),
        });
    }

    static getRateMessage(opts: { queryID?: number; address?: Address }) {
        return beginCell()
            .storeUint(Opcodes.providePoolRate, 32)
            .storeUint(opts.queryID ?? 0, 64)
            .storeAddress(opts.address)
            .endCell();
    }

    /* provide_wallet_address#2c76b973 query_id:uint64 owner_address:MsgAddress include_address:Bool = InternalMsgBody;
     */
    static discoveryMessage(owner: Address, include_address: boolean, queryId?: bigint) {
        return beginCell()
            .storeUint(Opcodes.provide_wallet_address, 32)
            .storeUint(queryId ?? 0, 64) // op, queryId
            .storeAddress(owner)
            .storeBit(include_address)
            .endCell();
    }

    async sendDiscovery(
        provider: ContractProvider,
        via: Sender,
        owner: Address,
        include_address: boolean,
        value: bigint = toNano('0.1'),
        queryId: bigint = 0n
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: ShardexPool.discoveryMessage(owner, include_address, queryId),
            value: value,
        });
    }

    async sendProvidePoolRate(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        opts: {
            queryID?: number;
            address?: Address;
        }
    ) {
        await provider.internal(via, {
            value: value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: ShardexPool.getRateMessage(opts),
        });
    }

    static takeRateMessage(opts: { queryID?: number; amountA: bigint; amountB: bigint }) {
        return beginCell()
            .storeUint(Opcodes.takePoolRate, 32)
            .storeUint(opts.queryID ?? 0, 64)
            .storeCoins(opts.amountA)
            .storeCoins(opts.amountB)
            .endCell();
    }

    async getJettonData(provider: ContractProvider): Promise<ShardexJettonData> {
        let res = await provider.get('get_jetton_data', []);
        let totalSupply = new BigNumber(res.stack.readBigNumber().toString());
        let mintable = res.stack.readBoolean();
        let adminAddress = res.stack.readAddress();
        let content = res.stack.readCell();
        let walletCode = res.stack.readCell();
        return {
            totalSupply,
            mintable,
            adminAddress,
            content,
            walletCode,
        };
    }

    async getWalletAddress(provider: ContractProvider, owner: Address): Promise<Address> {
        const res = await provider.get('get_wallet_address', [
            { type: 'slice', cell: beginCell().storeAddress(owner).endCell() },
        ]);
        return res.stack.readAddress();
    }

    async getPoolData(provider: ContractProvider): Promise<ShardexPoolData> {
        const result = await provider.get('get_pool_data', []);
        return {
            ...loadPool(result.stack.readCell()),
            fee: result.stack.readNumber(),
            protocolFee: result.stack.readNumber(),
            version: result.stack.readNumber(),
        };
    }

    async getTokensData(provider: ContractProvider): Promise<ShardexTokensData> {
        const result = await provider.get('get_tokens_data', []);
        return {
            tokenA: result.stack.readAddress(),
            tokenAAmount: new BigNumber(result.stack.readBigNumber().toString()),
            feeAAmount: new BigNumber(result.stack.readBigNumber().toString()),
            tokenB: result.stack.readAddress(),
            tokenBAmount: new BigNumber(result.stack.readBigNumber().toString()),
            feeBAmount: new BigNumber(result.stack.readBigNumber().toString()),
        };
    }

    async getSwapRate(provider: ContractProvider, opts: { vaultIn: Address; amountIn: bigint; customFee?: number }) {
        const { fee, protocolFee } = await this.getPoolData(provider);
        const txFee = Math.max(protocolFee, opts.customFee ?? 0);
        const tokens = await this.getTokensData(provider);
        const amountIn = new BigNumber(opts.amountIn.toString());

        const reserveIn = opts.vaultIn.equals(tokens.tokenA) ? tokens.tokenAAmount : tokens.tokenBAmount;
        const reserveOut = opts.vaultIn.equals(tokens.tokenA) ? tokens.tokenBAmount : tokens.tokenAAmount;

        const baseOut = ShardexPool.getAmountOut(amountIn, reserveIn, reserveOut, fee);

        const protocolFeeOut = baseOut.multipliedBy(txFee).div(ct_fee_divider);

        const amountOut = baseOut.minus(protocolFeeOut);

        return BigInt(amountOut.toFixed(0));
    }

    public static getAmountOut = (amountIn: BigNumber, reserveIn: BigNumber, reserveOut: BigNumber, fee: number) => {
        const amountInWithFee = amountIn.multipliedBy(ct_fee_divider - fee);
        const numerator = amountInWithFee.multipliedBy(reserveOut);
        const denominator = reserveIn.multipliedBy(ct_fee_divider).plus(amountInWithFee);
        const amountOut = numerator.div(denominator);
        return amountOut;
    };

    public static getAmountIn = (amountOut: BigNumber, reserveIn: BigNumber, reserveOut: BigNumber, fee: number) => {
        const numerator = reserveIn.multipliedBy(amountOut).multipliedBy(ct_fee_divider);
        const denominator = new BigNumber(reserveOut.minus(amountOut)).multipliedBy(ct_fee_divider - fee);
        const amountIn = numerator.div(denominator).plus(1);
        return amountIn;
    };

    async getExactOutSwapRate(
        provider: ContractProvider,
        opts: {
            vaultIn: Address;
            amountOut: bigint;
            extra?: number;
            customFee?: number;
        }
    ) {
        const { fee, protocolFee } = await this.getPoolData(provider);
        const txFee = Math.max(protocolFee, opts.customFee ?? 0);
        const tokens = await this.getTokensData(provider);
        const amountOut = new BigNumber(opts.amountOut.toString());

        const reserveIn = opts.vaultIn.equals(tokens.tokenA) ? tokens.tokenAAmount : tokens.tokenBAmount;
        const reserveOut = opts.vaultIn.equals(tokens.tokenA) ? tokens.tokenBAmount : tokens.tokenAAmount;

        const baseIn = ShardexPool.getAmountIn(amountOut, reserveIn, reserveOut, fee);

        const protocolFeeIn = baseIn.multipliedBy(txFee).div(ct_fee_divider);
        const amountIn = baseIn.plus(protocolFeeIn);

        const full = amountIn.multipliedBy(new BigNumber(1000 + (opts.extra ?? 10)).div(1000));

        const result = BigInt(full.toFixed(0, BigNumber.ROUND_UP));
        return result;
    }
}
