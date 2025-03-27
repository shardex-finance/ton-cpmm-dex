import { compile, NetworkProvider } from '@ton/blueprint';
import { Address, Cell, toNano } from '@ton/core';
import { JettonMinter } from '../wrappers/JettonMinter';
import { ShardexPool } from '../wrappers/ShardexPool';
import { PoolTokenKind } from '../wrappers/state';

export const admin = 'UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ';
export const fee = 20; // 0.2%

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();

    const jetton1 = await ui.inputAddress('Jetton Minter A');
    const jetton2 = await ui.inputAddress('Jetton Minter B');
    const index = await ui.input('Index');

    const shardex = provider.open(
        ShardexPool.createFromConfig(
            {
                admin: Address.parse(admin),
                index: Number(index),
                tokenA: { kind: PoolTokenKind.jetton, address: jetton1 },
                tokenB: { kind: PoolTokenKind.jetton, address: jetton2 },
                lpWalletCode: await compile('ShardexPoolJettonWallet'),
            },
            await compile('ShardexPool')
        )
    );

    const jettonMinterA = provider.open(JettonMinter.createFromAddress(jetton1));
    const jettonMinterB = provider.open(JettonMinter.createFromAddress(jetton2));

    await shardex.sendDeploy(provider.sender(), toNano('0.05'), {
        vaultA: await jettonMinterA.getWalletAddress(shardex.address),
        vaultB: await jettonMinterB.getWalletAddress(shardex.address),
        fee: fee,
        content: new Cell(),
    });

    await provider.waitForDeploy(shardex.address);
    const data = await shardex.getPoolData();
    console.log('Data', data.admin, data.fee, data.index.toString(), data.tokenA, data.tokenB, data.version);
}
