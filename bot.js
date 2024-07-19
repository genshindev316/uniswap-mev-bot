const { Web3 } = require('web3');

const config = require('./config.json');
// const { ChainId, Token, TokenAmount, WETH9, TradeType, Percent } = require('@uniswap/sdk-core');
// const { Pair, Route, Trade, Fetcher } = require("@uniswap/v2-sdk");
// const QuoteToken = new Token(ChainId.MAINNET, config.token, 18);

// BSC Testnet
const HTTP_RPC_PROVIDER_URL = 'https://bsc-testnet-rpc.publicnode.com';
const UNISWAP_V2_ROUTER02_ADDRESS = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";

// ABIs for Uniswap v2 Router and ERC20
const ERC20_ABI = require('./ERC20-ABI.json');
const UNISWAP_V2_ROUTER02_ABI = require('./unisap-v2-router-abi.json');

const web3 = new Web3(HTTP_RPC_PROVIDER_URL);
const contractUniswapV2Router02 = new web3.eth.Contract(UNISWAP_V2_ROUTER02_ABI, UNISWAP_V2_ROUTER02_ADDRESS);

const quoteTokenAddress = config.token;
const etherTokenAddress = config.etherTokenAddress;
const contractQuoteToken = new web3.eth.Contract(ERC20_ABI, quoteTokenAddress);
// console.log(contractQuoteToken)
const QUOTED_TOKEN_DECIMALS = 18;
const bundleTransactions = [];
const randAmountArray = [];

const wallet = web3.eth.accounts.wallet.create();
config.wallets.map((wal) => {
  const account = web3.eth.accounts.privateKeyToAccount('0x' + wal.private_key);
  wallet.add(account);
});

// Choose random amount for the given range for each wallet to buy tokens.
function randAmount() {
  var rand_min = 0;
  var rand_max = 0;
  config.wallets.map(wal => {
    rand_min = wal.buy_min;
    rand_max = wal.buy_max;
    randAmountToBuy = {
      "address": wal.private_key,
      "randAmountForWallet": rand_min + Math.random() * (rand_max - rand_min)
    }
    randAmountArray.push(randAmountToBuy);
  });
}

async function addLiquidityPool(amountTokenDesired, amountETHDesired, amountTokenMin, amountETHMin, provider) {
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
      value: amountETHDesired
    });
    return resultOfAddLiquidityPool;
  } catch (e) {
    console.log(e);
    return e;
  };
};

async function swapQuotedTokensForETH(amountQuotedToken, _to) {
  const amountETHMin = '0'; // Minimum amount of ETH to receive (in wei)
  const WETH_ADDRESS = await contractUniswapV2Router02.methods.WETH().call();
  const path = [quoteTokenAddress, WETH_ADDRESS];
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
  const WETH_ADDRESS = await contractUniswapV2Router02.methods.WETH().call();
  const path = [WETH_ADDRESS, quoteTokenAddress];
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
  // transaction which swap eth to token
  const swapTx1 = await swapETHForQuotedTokens(wallet[0].address); // .send({value: 100000000})
  const nonce1 = await web3.eth.getTransactionCount(wallet[0].address);
  const gasPrice1 = await web3.eth.getGasPrice();
  const tx1 = {
    from: wallet[0].address,
    to: UNISWAP_V2_ROUTER02_ADDRESS,
    data: swapTx1,
    gas: "30000",
    gasPrice: gasPrice1,
    nonce: nonce1,
    // value: `0x + ${randAmountArray[0].toString()}`
    value: "1000000"
  };
  const signedTx1 = await web3.eth.accounts.signTransaction(tx1, wallet[0].privateKey);
  bundleTransactions.push(signedTx1);
  
  // transaction which swap token to eth
  // const {swapTx2, Tx2} = await swapQuotedTokensForETH(wallet[1].address);
  // const nonce2 = await web3.eth.getTransactionCount(wallet[1].address);
  // const gasPrice2 = await web3.eth.getGasPrice();
  // const tx2 = {
  //   from: wallet[1].address,
  //   to: UNISWAP_V2_ROUTER02_ADDRESS,
  //   data: Tx2,
  //   gas: "30000",
  //   gasPrice: gasPrice2,
  //   nonce: nonce2,
  //   // value: randAmountArray[1]
  //   value: "1000000"
  // };
  // const signedTx2 = await web3.eth.accounts.signTransaction(tx2, wallet[1].privateKey);
  // bundleTransactions.push(signedTx2);

  // ... add more transactions in bundleTransactoins ...
};

async function submitTransactionsToMEVRelay(bundle) {
  const mevRelayUrl1 = 'https://0xac6e77dfe25ecd6110b8e780608cce0dab71fdd5ebea22a16c0205200f2f8e2e3ad3b71d3499c54ad14d6c21b41a37ae@boost-relay.flashbots.net'; // Replace with actual MEV relay endpoint
  // const mevRelayUrl2 = 'https://0xac6e77dfe25ecd6110b8e780608cce0dab71fdd5ebea22a16c0205200f2f8e2e3ad3b71d3499c54ad14d6c21b41a37ae@boost-relay.flashbots.net';
  // const mevRelayUrl3 = 'https://0xac6e77dfe25ecd6110b8e780608cce0dab71fdd5ebea22a16c0205200f2f8e2e3ad3b71d3499c54ad14d6c21b41a37ae@boost-relay.flashbots.net'; // ..add 12 MEV relays URLs
  // const mevRelayUrls = [];

  // will add 12 MEV Urls into mevRelayUrls
  // for (var i = 0; i < 12; i++) {
  //   mevRelayUrls.push(mevRelayUrli);
  // }
  // mevRelayUrls.push(mevRelayUrl1);
  // mevRelayUrls.push(mevRelayUrl2);
  // mevRelayUrls.push(mevRelayUrl3);

  const headers = {
    'Content-Type': 'application/json',
    // Add any necessary authentication headers or API keys
  };

  const requestOptions = {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(bundle),
  };

  // for(i in mevRelayUrls) {
    try {
      console.log("AAA")
      const response = await fetch(mevRelayUrl1, requestOptions);
      const result = await response.json();    
      console.log('Transactions submitted:', result);
    } catch (error) {
        console.error('Error submitting transactions:', error);
    };
  // };
};

async function main() {
  randAmount();
  await addLiquidityPool(config['lp-amount'].token, config['lp-amount'].eth, '0', '0', wallet[0].address); // you can choose your wallet
  buildMEVBundle();

  submitTransactionsToMEVRelay(bundleTransactions);
};

main();