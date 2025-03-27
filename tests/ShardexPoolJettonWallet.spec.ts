import { compile } from '@ton/blueprint';
import { Cell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import { ShardexPoolJettonWallet } from '../wrappers/ShardexPoolJettonWallet';

describe('ShardexPoolJettonWallet', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('ShardexPoolJettonWallet');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let user: SandboxContract<TreasuryContract>;
    let shardexPoolJettonWallet: SandboxContract<ShardexPoolJettonWallet>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        deployer = await blockchain.treasury('deployer');
        user = await blockchain.treasury('user');

        shardexPoolJettonWallet = blockchain.openContract(
            ShardexPoolJettonWallet.createFromConfig(
                {
                    jetton_master_address: deployer.address,
                    owner_address: user.address,
                },
                code
            )
        );

        const deployResult = await shardexPoolJettonWallet.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: shardexPoolJettonWallet.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and shardexPoolJettonWallet are ready to use
    });
});
