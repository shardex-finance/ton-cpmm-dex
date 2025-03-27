import {
  Address,
  beginCell,
  Cell,
  Contract,
  contractAddress,
  ContractProvider,
  Sender,
  SendMode,
} from "@ton/core";
import BigNumber from "bignumber.js";

export type VaultData = {
  balance: BigNumber;
  owner: Address;
};

export type TonVaultConfig = {
  owner: Address;
};

export enum VaultOp {
  depositVault = 0x246e4067,
  transfer = 0xf8a7ea5,
  transferNotification = 0x7362d09c,
  excesses = 0xd53276db,
  topUp = 0xd372158c,
}

export function tonVaultConfigToCell(config: TonVaultConfig): Cell {
  return beginCell().storeCoins(0).storeAddress(config.owner).endCell();
}

export class TonVault implements Contract {
  constructor(
    readonly address: Address,
    readonly init?: { code: Cell; data: Cell }
  ) {}

  static createFromAddress(address: Address) {
    return new TonVault(address);
  }

  static createFromConfig(config: TonVaultConfig, code: Cell, workchain = 0) {
    const data = tonVaultConfigToCell(config);
    const init = { code, data };
    return new TonVault(contractAddress(workchain, init), init);
  }

  async getState(provider: ContractProvider) {
    let state = await provider.getState();
    return state;
  }

  async getVaultData(provider: ContractProvider): Promise<VaultData> {
    let state = await provider.getState();
    if (state.state.type !== "active") {
      return {
        balance: new BigNumber(0),
        owner: null!,
      };
    }
    let res = await provider.get("get_vault_data", []);
    return {
      balance: new BigNumber(res.stack.readBigNumber().toString()),
      owner: res.stack.readAddress(),
    };
  }

  static transferNotificationMessage(opts: {
    queryId?: number;
    tokenAmount: bigint;
    owner: Address;
    forwardPayload: Cell | null;
  }) {
    return beginCell()
      .storeUint(VaultOp.transferNotification, 32)
      .storeUint(opts.queryId ?? 0, 64)
      .storeCoins(opts.tokenAmount)
      .storeAddress(opts.owner)
      .storeMaybeRef(opts.forwardPayload)
      .endCell();
  }

  static excessesMessage(opts: { queryId?: number }) {
    return beginCell()
      .storeUint(VaultOp.excesses, 32)
      .storeUint(opts.queryId ?? 0, 64)
      .endCell();
  }

  static topUpMessage(opts: { queryId?: number }) {
    return beginCell()
      .storeUint(VaultOp.topUp, 32)
      .storeUint(opts.queryId ?? 0, 64)
      .endCell();
  }

  async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: TonVault.topUpMessage({}),
      value: value,
    });
  }

  static depositVaultMessage(opts: {
    queryId?: bigint;
    tonAmount: bigint;
    responseAddress: Address | null;
    forwardTonAmount: bigint;
    forwardPayload: Cell | null;
  }) {
    return beginCell()
      .storeUint(VaultOp.depositVault, 32)
      .storeUint(opts.queryId ?? 0, 64)
      .storeCoins(opts.tonAmount)
      .storeAddress(opts.responseAddress)
      .storeCoins(opts.forwardTonAmount)
      .storeMaybeRef(opts.forwardPayload)
      .endCell();
  }

  async sendDeposit(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    tonAmount: bigint,
    responseAddress: Address,
    forwardTonAmount: bigint,
    forwardPayload: Cell | null,
    queryId?: bigint
  ) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: TonVault.depositVaultMessage({
        tonAmount,
        responseAddress,
        forwardTonAmount,
        forwardPayload,
        queryId,
      }),
      value: value,
    });
  }

  static transferMessage(opts: {
    queryId?: number;
    tonAmount: bigint;
    to: Address;
    responseAddress: Address | null;
    forwardPayload: Cell | null;
  }) {
    return beginCell()
      .storeUint(VaultOp.transfer, 32)
      .storeUint(opts.queryId ?? 0, 64)
      .storeCoins(opts.tonAmount)
      .storeAddress(opts.to)
      .storeAddress(opts.responseAddress)
      .storeMaybeRef(null)
      .storeCoins(0)
      .storeMaybeRef(opts.forwardPayload)
      .endCell();
  }

  async sendTransfer(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    tonAmount: bigint,
    to: Address,
    responseAddress: Address,
    forwardPayload: Cell | null
  ) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: TonVault.transferMessage({
        tonAmount,
        to,
        responseAddress,
        forwardPayload,
      }),
      value: value,
    });
  }
}
