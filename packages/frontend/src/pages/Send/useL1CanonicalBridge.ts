import { useCallback, useEffect, useState } from 'react'
import { ChainId, Hop, NetworkSlug, Token } from '@hop-protocol/sdk'
import { BigNumber, BigNumberish, constants } from 'ethers'
import Chain from 'src/models/Chain'
import { useWeb3Context } from 'src/contexts/Web3Context'
import logger from 'src/logger'
import { findNetworkById, formatError, toTokenDisplay } from 'src/utils'
import CanonicalBridge from 'src/models/CanonicalBridge'
import { l1Network } from 'src/config/networks'
import { TxConfirm } from 'src/contexts/AppContext/useTxConfirm'
import { useQuery } from 'react-query'

interface L1CanonicalBridgeProps {
  sdk?: Hop
  sourceToken?: Token
  sourceTokenAmount?: BigNumber
  destinationChain?: Chain
  estimatedReceived?: BigNumber
  txConfirm?: TxConfirm
  customRecipient?: string
  handleTransaction?: any
  setSending?: any
  setTx?: any
  waitForTransaction?: any
  updateTransaction?: any
  setApproving?: any
}

export function useL1CanonicalBridge(props: L1CanonicalBridgeProps) {
  const {
    sdk,
    sourceToken,
    sourceTokenAmount,
    destinationChain,
    estimatedReceived,
    txConfirm,
    customRecipient,
    handleTransaction,
    setSending,
    setTx,
    waitForTransaction,
    updateTransaction,
    setApproving,
  } = props

  const { checkConnectedNetworkId, provider } = useWeb3Context()
  const [l1CanonicalBridge, setL1CanonicalBridge] = useState<CanonicalBridge | undefined>()
  const [usingNativeBridge, setUsingNativeBridge] = useState(false)
  const [userSpecifiedBridge, setUserSpecifiedBridge] = useState(false)

  function selectNativeBridge(val: boolean) {
    setUsingNativeBridge(val)
    setUserSpecifiedBridge(true)
  }

  const sourceChain = findNetworkById(sourceToken?.chain.chainId!)

  const { data: needsNativeBridgeApproval } = useQuery(
    [
      `needsNativeBridgeApproval:${l1CanonicalBridge?.address}:${sourceTokenAmount?.toString()}`,
      l1CanonicalBridge?.address,
      sourceTokenAmount?.toString(),
      usingNativeBridge,
    ],
    async () => {
      if (!(usingNativeBridge && l1CanonicalBridge && sourceTokenAmount)) {
        return
      }

      const allowance = await l1CanonicalBridge.getL1CanonicalAllowance()
      return allowance?.lt(sourceTokenAmount)
    },
    {
      enabled:
        !!usingNativeBridge && !!l1CanonicalBridge?.address && !!sourceTokenAmount?.toString(),
      refetchInterval: 10e3,
    }
  )

  useEffect(() => {
    if (userSpecifiedBridge) return

    if (sourceTokenAmount && estimatedReceived && l1CanonicalBridge) {
      if (!usingNativeBridge && sourceTokenAmount.gt(estimatedReceived)) {
        setUsingNativeBridge(true)
      } else if (sourceTokenAmount.lte(estimatedReceived)) {
        setUsingNativeBridge(false)
      }
    }

    return () => setUserSpecifiedBridge(false)
  }, [
    sourceTokenAmount?.toString(),
    estimatedReceived?.toString(),
    l1CanonicalBridge,
    destinationChain,
  ])

  useEffect(() => {
    if (!(sourceToken && destinationChain && sourceTokenAmount)) {
      return setL1CanonicalBridge(undefined)
    }

    if (sourceToken.chain.chainId !== ChainId.Ethereum) {
      return setL1CanonicalBridge(undefined)
    }

    const signer = provider?.getSigner()
    if (signer) {
      const canonicalBridge = new CanonicalBridge(
        NetworkSlug.Mainnet,
        signer,
        sourceToken.symbol,
        destinationChain.slug
      )
      setL1CanonicalBridge(canonicalBridge)
    }
  }, [provider, sourceTokenAmount?.toString(), sourceToken, destinationChain?.slug])

  const approveNativeBridge = async () => {
    if (!(needsNativeBridgeApproval && l1CanonicalBridge && txConfirm)) {
      setApproving(false)
      return
    }

    try {
      const tx: any = await txConfirm.show({
        kind: 'approval',
        inputProps: {
          tagline: `Allow Hop to spend your ${sourceToken?.symbol} on ${sourceToken?.chain.name}`,
          source: {
            network: {
              slug: sourceToken?.chain.slug,
              networkId: sourceToken?.chain.chainId,
            },
          },
        },
        onConfirm: async () => {
          const approveAmount = constants.MaxUint256

          const networkId = sourceToken!.chain.chainId
          const isNetworkConnected = await checkConnectedNetworkId(networkId)
          if (!isNetworkConnected) return

          setApproving(true)
          return l1CanonicalBridge.approve(approveAmount as BigNumberish)
        },
      })

      setApproving(false)
      if (tx?.hash) {
        return handleTransaction(tx, sourceChain, destinationChain, sourceToken)
      }
    } catch (error: any) {
      setApproving(false)
      if (!/cancelled/gi.test(error.message)) {
        // noop
        return
      }
      throw new Error(error.message)
    }
  }

  async function sendL1CanonicalBridge() {
    if (
      !(
        sdk &&
        l1CanonicalBridge &&
        sourceToken &&
        sourceTokenAmount &&
        sourceChain &&
        destinationChain &&
        !needsNativeBridgeApproval &&
        txConfirm
      )
    ) {
      setApproving(false)
      return
    }

    // if (shouldApproveNativeBridge) {
    //   const approveTx = await l1CanonicalBridge.approve(constants.MaxUint256)
    //   await approveTx.wait()
    // }

    const tx: any = await txConfirm.show({
      kind: 'depositNativeBridge',
      inputProps: {
        customRecipient,
        source: {
          amount: toTokenDisplay(sourceTokenAmount, sourceToken?.decimals),
          token: sourceToken,
          network: sourceChain,
        },
        dest: {
          network: destinationChain,
        },
        estimatedReceived: toTokenDisplay(
          estimatedReceived,
          sourceToken?.decimals,
          sourceToken?.symbol
        ),
      },
      onConfirm: async () => {
        try {
          const isNetworkConnected = await checkConnectedNetworkId(l1Network.networkId)
          if (!isNetworkConnected) return

          setSending(true)
          return l1CanonicalBridge.deposit(sourceTokenAmount)
        } catch (error: any) {
          setSending(false)
          if (!/cancelled/gi.test(error.message)) {
            // noop
            return
          }
          logger.error(formatError(error))
        }
      },
    })
    logger.debug(`tx:`, tx)
    setSending(false)

    const txHandled = handleTransaction(tx, sourceChain, destinationChain, sourceToken)
    logger.debug(`txHandled:`, txHandled)

    const { transaction, txModel } = txHandled

    const watcher = (sdk as Hop).watch(
      txModel.hash,
      sourceToken.symbol,
      sourceChain.slug,
      destinationChain.slug
    )

    if (watcher) {
      watcher.once(sdk.Event.DestinationTxReceipt, async data => {
        logger.debug(`dest tx receipt event data:`, data)
        if (txModel && !txModel.destTxHash) {
          const opts = {
            destTxHash: data.receipt.transactionHash,
            pendingDestinationConfirmation: false,
          }
          updateTransaction(txModel, opts)
        }
      })
    }

    setTx(txModel)

    const txModelArgs = {
      networkName: sourceChain,
      destNetworkName: destinationChain,
      token: sourceToken,
    }

    console.log(`transaction:`, transaction)
    // TODO: DRY. this is copied from useSendTransaction and shouldn't be re-written
    const res = await waitForTransaction(transaction, txModelArgs)

    if (res && 'replacementTxModel' in res) {
      setTx(res.replacementTxModel)
      const { replacementTxModel: txModelReplacement } = res

      if (sourceChain && destinationChain) {
        // Replace watcher
        const replacementWatcher = sdk?.watch(
          txModelReplacement.hash,
          sourceToken!.symbol,
          sourceChain?.slug,
          destinationChain?.slug
        )
        replacementWatcher.once(sdk?.Event.DestinationTxReceipt, async data => {
          logger.debug(`replacement dest tx receipt event data:`, data)
          if (txModelReplacement && !txModelReplacement.destTxHash) {
            const opts = {
              destTxHash: data.receipt.transactionHash,
              pendingDestinationConfirmation: false,
              replaced: transaction.hash,
            }
            updateTransaction(txModelReplacement, opts)
          }
        })
      }
    }

    setSending(false)

    console.log(`tx:`, tx)
    return handleTransaction(tx, sourceChain, destinationChain, sourceToken)
  }

  const estimateApproveNativeBridge = useCallback(
    async (opts?: any) => {
      if (!l1CanonicalBridge || !sourceTokenAmount) {
        return
      }

      const spender = l1CanonicalBridge.getDepositApprovalAddress()
      if (!spender) {
        throw new Error(
          `token "${l1CanonicalBridge.tokenSymbol}" on chain "${l1CanonicalBridge.chain.slug}" is unsupported`
        )
      }
      return l1CanonicalBridge.estimateApproveTx(sourceTokenAmount)
    },
    [l1CanonicalBridge, sourceTokenAmount]
  )

  return {
    sendL1CanonicalBridge,
    l1CanonicalBridge,
    usingNativeBridge,
    setUsingNativeBridge,
    selectNativeBridge,
    needsNativeBridgeApproval,
    approveNativeBridge,
    estimateApproveNativeBridge,
  }
}
