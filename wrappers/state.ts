import { Address, beginCell, Builder, Cell, Slice } from '@ton/core';

export enum PoolTokenKind {
    jetton = 0,
    ton = 1,
    extraCurrency = 2,
}

export type PoolToken =
    | { kind: PoolTokenKind.jetton; address: Address }
    | { kind: PoolTokenKind.ton }
    | { kind: PoolTokenKind.extraCurrency; id: number };

export enum PoolVersion {
    v0 = 0,
}

export type InitPoolConfig = {
    admin: Address;
    index: number;
    tokenA: PoolToken;
    tokenB: PoolToken;
    lpWalletCode: Cell;
    version?: PoolVersion;
};

export type ShardexPoolData = {
    admin: Address;
    tokenA: PoolToken;
    tokenB: PoolToken;
    index: bigint;
    fee: number;
    protocolFee: number;
    version: PoolVersion;
};

export type ShardexPoolConfig = {
    admin: Address;
    index: number;
    tokenA: PoolToken;
    tokenB: PoolToken;
    lpWalletCode: Cell;
    version?: PoolVersion;
};

export const PoolTokenSize = 4;

export const loadPoolToken = (ps: Slice): PoolToken => {
    const type: PoolTokenKind = ps.loadUint(PoolTokenSize);
    switch (type) {
        case PoolTokenKind.jetton: {
            return {
                kind: PoolTokenKind.jetton,
                address: ps.loadAddress(),
            };
        }
        case PoolTokenKind.ton: {
            return {
                kind: PoolTokenKind.ton,
            };
        }
        case PoolTokenKind.extraCurrency: {
            return {
                kind: PoolTokenKind.extraCurrency,
                id: ps.loadUint(32),
            };
        }
    }
};

interface PoolData {
    admin: Address;
    tokenA: PoolToken;
    tokenB: PoolToken;
    index: bigint;
}

export const loadPool = (pool: Cell): PoolData => {
    const ps = pool.beginParse();
    return {
        admin: ps.loadAddress(),
        tokenA: loadPoolToken(ps),
        tokenB: loadPoolToken(ps),
        index: ps.loadCoins(),
    };
};

function shardexTokenToCell(result: Builder, config: PoolToken): Builder {
    switch (config.kind) {
        case PoolTokenKind.ton: {
            return result.storeUint(PoolTokenKind.ton, PoolTokenSize);
        }
        case PoolTokenKind.jetton: {
            return result.storeUint(PoolTokenKind.jetton, PoolTokenSize).storeAddress(config.address);
        }
        case PoolTokenKind.extraCurrency: {
            return result.storeUint(PoolTokenKind.extraCurrency, PoolTokenSize).storeUint(config.id, 32);
        }
    }
}

function shardexTokensToCell(config: ShardexPoolConfig): Cell {
    let result = beginCell().storeAddress(config.admin);

    result = shardexTokenToCell(result, config.tokenA);
    result = shardexTokenToCell(result, config.tokenB);

    return result.storeUint(config.index, 64).storeRef(beginCell().endCell()).endCell();
}

export interface PoolReselve {
    tokenAAmount: bigint;
    feeAAmount: bigint;
    tokenBAmount: bigint;
    feeBAmount: bigint;
}
const beginPoolReselve = (state: Partial<PoolReselve>): Cell => {
    return beginCell()
        .storeCoins(state.tokenAAmount ?? 0)
        .storeCoins(state.feeAAmount ?? 0)
        .storeCoins(state.tokenBAmount ?? 0)
        .storeCoins(state.feeBAmount ?? 0)
        .endCell();
};

export const loadPoolReselve = (cell: Cell): PoolReselve => {
    const sl = cell.beginParse();
    return {
        tokenAAmount: sl.loadCoins(),
        feeAAmount: sl.loadCoins(),
        tokenBAmount: sl.loadCoins(),
        feeBAmount: sl.loadCoins(),
    };
};

export function poolConfigToCell(config: ShardexPoolConfig): Cell {
    return beginCell()
        .storeAddress(null)
        .storeAddress(null)
        .storeUint(config.version ?? PoolVersion.v0, 7)
        .storeUint(0, 8)
        .storeUint(0, 8)
        .storeCoins(0)
        .storeRef(shardexTokensToCell(config))
        .storeRef(beginPoolReselve({}))
        .storeRef(config.lpWalletCode)
        .endCell();
}

export interface PoolState {
    tokenWalletA: Address;
    tokenWalletB: Address;
    version: number;
    lpFee: number;
    protocolFee: number;
    totalSupply: bigint;
    pool: PoolData;
    reserve: PoolReselve;
    lpWalletCode: Cell;
}

export const loadPoolConfig = (cell: Cell): PoolState => {
    const sl = cell.beginParse();

    const pool = loadPool(sl.loadRef());
    const reserve = loadPoolReselve(sl.loadRef());
    const lpWalletCode = sl.loadRef();

    return {
        tokenWalletA: sl.loadAddress(),
        tokenWalletB: sl.loadAddress(),
        version: sl.loadUint(7),
        lpFee: sl.loadUint(8),
        protocolFee: sl.loadUint(8),
        totalSupply: sl.loadCoins(),
        pool,
        reserve,
        lpWalletCode,
    };
};
