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

export type ShardexPoolJettonWalletConfig = {
    owner_address: Address;
    jetton_master_address: Address;
};

export enum PoolJettonWalletOp {
    burn = 0x595f07bc,
    boost = 0x8295a228,
}

export function shardexPoolJettonWalletConfigToCell(config: ShardexPoolJettonWalletConfig): Cell {
    return beginCell()
        .storeCoins(0)
        .storeAddress(config.owner_address)
        .storeAddress(config.jetton_master_address)
        .storeMaybeRef(null)
        .endCell();
}

export class ShardexPoolJettonWallet implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new ShardexPoolJettonWallet(address);
    }

    static createFromConfig(config: ShardexPoolJettonWalletConfig, code: Cell, workchain = 0) {
        const data = shardexPoolJettonWalletConfigToCell(config);
        const init = { code, data };
        return new ShardexPoolJettonWallet(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0xd372158c, 32).storeUint(0, 64).endCell(),
        });
    }

    async getJettonBalance(provider: ContractProvider) {
        let state = await provider.getState();
        if (state.state.type !== 'active') {
            return 0n;
        }
        let res = await provider.get('get_wallet_data', []);
        return res.stack.readBigNumber();
    }

    static internalMessage(opts: {
        jettonAmount: bigint;
        to: Address;
        responseAddress: Address;
        forwardTonAmount: bigint;
        forwardPayload: Cell | null;
    }) {
        return beginCell()
            .storeUint(0x178d4519, 32)
            .storeUint(0, 64) // op, queryId
            .storeCoins(opts.jettonAmount)
            .storeAddress(opts.to)
            .storeAddress(opts.responseAddress)
            .storeCoins(opts.forwardTonAmount)
            .storeMaybeRef(opts.forwardPayload)
            .endCell();
    }

    static transferMessage(
        jetton_amount: bigint,
        to: Address,
        responseAddress: Address | null,
        customPayload: Cell | null,
        forward_ton_amount: bigint,
        forwardPayload: Cell | null
    ) {
        return beginCell()
            .storeUint(0xf8a7ea5, 32)
            .storeUint(0, 64) // op, queryId
            .storeCoins(jetton_amount)
            .storeAddress(to)
            .storeAddress(responseAddress)
            .storeMaybeRef(customPayload)
            .storeCoins(forward_ton_amount)
            .storeMaybeRef(forwardPayload)
            .endCell();
    }
    async sendTransfer(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        jetton_amount: bigint,
        to: Address,
        responseAddress: Address,
        customPayload: Cell | null,
        forward_ton_amount: bigint,
        forwardPayload: Cell | null
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: ShardexPoolJettonWallet.transferMessage(
                jetton_amount,
                to,
                responseAddress,
                customPayload,
                forward_ton_amount,
                forwardPayload
            ),
            value: value,
        });
    }
    /*
      burn#595f07bc query_id:uint64 amount:(VarUInteger 16)
                    response_destination:MsgAddress custom_payload:(Maybe ^Cell)
                    = InternalMsgBody;
    */
    static burnMessage(jetton_amount: bigint, responseAddress: Address, customPayload: Cell | null) {
        return beginCell()
            .storeUint(PoolJettonWalletOp.burn, 32)
            .storeUint(0, 64) // op, queryId
            .storeCoins(jetton_amount)
            .storeAddress(responseAddress)
            .storeMaybeRef(customPayload)
            .endCell();
    }

    async sendBurn(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        jetton_amount: bigint,
        responseAddress: Address,
        customPayload: Cell | null
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: ShardexPoolJettonWallet.burnMessage(jetton_amount, responseAddress, customPayload),
            value: value,
        });
    }

    static boostMessage(jetton_amount: bigint, responseAddress: Address) {
        return beginCell()
            .storeUint(PoolJettonWalletOp.boost, 32)
            .storeUint(0, 64) // op, queryId
            .storeCoins(jetton_amount)
            .storeAddress(responseAddress)
            .endCell();
    }

    async sendBoost(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        jetton_amount: bigint,
        responseAddress: Address
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: ShardexPoolJettonWallet.boostMessage(jetton_amount, responseAddress),
            value: value,
        });
    }

    /*
      withdraw_tons#107c49ef query_id:uint64 = InternalMsgBody;
    */
    static withdrawTonsMessage() {
        return beginCell()
            .storeUint(0x6d8e5e3c, 32)
            .storeUint(0, 64) // op, queryId
            .endCell();
    }

    async sendWithdrawTons(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: ShardexPoolJettonWallet.withdrawTonsMessage(),
            value: toNano('0.1'),
        });
    }
    /*
      withdraw_jettons#10 query_id:uint64 wallet:MsgAddressInt amount:Coins = InternalMsgBody;
    */
    static withdrawJettonsMessage(from: Address, amount: bigint) {
        return beginCell()
            .storeUint(0x768a50b2, 32)
            .storeUint(0, 64) // op, queryId
            .storeAddress(from)
            .storeCoins(amount)
            .storeMaybeRef(null)
            .endCell();
    }

    async sendWithdrawJettons(provider: ContractProvider, via: Sender, from: Address, amount: bigint) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: ShardexPoolJettonWallet.withdrawJettonsMessage(from, amount),
            value: toNano('0.1'),
        });
    }
}
