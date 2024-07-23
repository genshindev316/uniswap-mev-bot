const { Web3 } = require('web3');
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle");
const { ethers } = require("ethers");
const config = require('./config.json');

const HTTP_RPC_PROVIDER_URL = 'wss://ethereum-sepolia-rpc.publicnode.com';
const MEV_RELAY_PROVIDER_URL = 'https://relay-sepolia.flashbots.net';
const provider = new ethers.getDefaultProvider("sepolia");
const web3 = new Web3(HTTP_RPC_PROVIDER_URL);

// ABIs for Uniswap v2 Router and ERC20
const ERC20_ABI = require('./ERC20-ABI.json');
const QuoteToken_ABI = require('./QuoteToken-ABI.json');
const UNISWAP_V2_ROUTER02_ABI = require('./unisap-v2-router-abi.json');
const UNISWAP_V2_ROUTER02_ADDRESS = "0x86dcd3293C53Cf8EFd7303B57beb2a3F671dDE98";

const contractUniswapV2Router02 = new web3.eth.Contract(UNISWAP_V2_ROUTER02_ABI, UNISWAP_V2_ROUTER02_ADDRESS);
const wallet = web3.eth.accounts.wallet.create();
config.wallets.map((wal) => {
  const account = web3.eth.accounts.privateKeyToAccount('0x' + wal.private_key);
  wallet.add(account);
});
const authSigner = new ethers.Wallet(
  wallet[0].privateKey,
  provider
);

const quoteTokenAddress = config.LINK;
const etherTokenAddress = config.SETH;
const contractQuoteToken = new web3.eth.Contract(QuoteToken_ABI, quoteTokenAddress);
const randAmountArray = [];

// Choose random amount for the given range for each wallet to buy tokens.
function randAmount() {
  var rand_min = 0;
  var rand_max = 0;
  config.wallets.map(wal => {
    rand_min = wal.buy_min;
    rand_max = wal.buy_max;
    randAmountToBuy = {
      "address": wal.id,
      "randAmountForWallet": rand_min + Math.floor(Math.random() * (rand_max - rand_min))
    };
    randAmountArray.push(randAmountToBuy);
  });
}

async function addLiquidityPool(amountTokenDesired, amountETHDesired, amountTokenMin, amountETHMin, provider) { // addLiquidityPool is OK
  try {
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now
    await contractQuoteToken.methods.approve(UNISWAP_V2_ROUTER02_ADDRESS, amountTokenDesired).send({ from: provider });

    const resultOfAddLiquidityPool = await contractUniswapV2Router02.methods.addLiquidityETH(
      quoteTokenAddress,
      amountTokenDesired,
      amountTokenMin,
      amountETHMin,
      provider,
      deadline
    ).send({
      from: provider,
      value: amountETHDesired,
      gas: 10000
    });
    return resultOfAddLiquidityPool;
  } catch (e) {
    console.log(e);
    return e;
  };
};

async function swapQuotedTokensForETH(amountQuotedToken, _to) {
  const amountETHMin = '0'; // Minimum amount of ETH to receive (in wei)
  // const WETH_ADDRESS = await contractUniswapV2Router02.methods.WETH().call();
  const path = [quoteTokenAddress, etherTokenAddress];
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

  const approveTx = await contractQuoteToken.methods.approve(UNISWAP_V2_ROUTER02_ADDRESS, amountQuotedToken).send({from: _to});

  const tx = await contractUniswapV2Router02.methods.swapExactTokensForETH(
    amountQuotedToken,
    amountETHMin,
    path,
    _to,
    deadline
  ).encodeABI();//send({from: buyer,gasLimit: web3.utils.toHex(3000000), gasPrice: web3.utils.toHex(web3.utils.toWei('10', 'gwei'))});

  return {approveTx, tx};
};

async function swapETHForQuotedTokens(_to) {
  const amountTokenMin = '0'; // Minimum amount of tokens to receive (in wei)
  const path = [etherTokenAddress, quoteTokenAddress];
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

  const tx = await contractUniswapV2Router02.methods.swapExactETHForTokens(
    amountTokenMin,
    path,
    _to,
    deadline
  ).encodeABI();//.send({from: buyer,value: amountETH,gasLimit: web3.utils.toHex(3000000),gasPrice: web3.utils.toHex(web3.utils.toWei('10', 'gwei'))});

  return tx;
};

// build MEV bundle
async function buildMEVBundle() {
  const swapTx1 = await swapETHForQuotedTokens(wallet[0].address); // .send({value: 100000000})
  const nonce1 = await web3.eth.getTransactionCount(wallet[0].address);
  const gasPrice1 = await web3.eth.getGasPrice();

  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    authSigner,
    MEV_RELAY_PROVIDER_URL,
    "sepolia"
  );

  const tx1 = {
    to: UNISWAP_V2_ROUTER02_ADDRESS,
    data: swapTx1,
    gasLimit: 2000000,
    gasPrice: gasPrice1,
    nonce: nonce1,
  };
  const signedTx1 = await web3.eth.accounts.signTransaction(tx1, wallet[0].privateKey); // signTransaction is OK
  const walletSigner = new ethers.Wallet(wallet[0].privateKey, provider);
  const signedTransactions = await flashbotsProvider.signBundle([
    {
      signer: walletSigner,
      signedTx1,
    },
  ]);

  const blockNumber = await provider.getBlockNumber();

  console.log(new Date());
  const simulation = await flashbotsProvider.simulate(
    signedTransactions,
    blockNumber + 1
  );
  console.log(new Date());

  if ("error" in simulation) {
    console.log(`Simulation Error: ${simulation.error.message}`);
  } else {
    console.log(
      `Simulation Success: ${blockNumber} ${JSON.stringify(
        simulation,
        null,
        2
      )}`
    );
  }
  console.log(signedTransactions);

  for (var i = 1; i <= 12; i++) {
    const bundleSubmission = flashbotsProvider.sendRawBundle(
      signedTransactions,
      blockNumber + i
    );
    console.log("submitted for block # ", blockNumber + i);
  }
  console.log("bundles submitted");

  // ... add more transactions in bundleTransactoins ...
};

async function main() {
  randAmount();
  // await addLiquidityPool(config['lp-amount'].token, config['lp-amount'].eth, '0', '0', wallet[0].address); // you can choose your wallet
  buildMEVBundle();
};

main();