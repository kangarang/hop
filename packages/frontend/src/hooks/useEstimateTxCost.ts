import { useState, useCallback } from 'react'
import { BigNumber, constants, providers } from 'ethers'
import logger from 'src/logger'
import Transaction from 'src/models/Transaction'
import { Token, ChainSlug } from '@hop-protocol/sdk'
import { useApp } from 'src/contexts/AppContext'
import Chain from 'src/models/Chain'
import { formatError } from 'src/utils'

export enum MethodNames {
  convertTokens = 'convertTokens',
  wrapToken = 'wrapToken',
}

export async function getGasCostByGasLimit(
  provider: providers.Provider,
  estimatedGasLimit: BigNumber
) {
  try {
    // Get current gas price
    const gasPrice = await provider.getGasPrice()
    // Add some wiggle room
    const bufferGas = BigNumber.from(70_000)
    return estimatedGasLimit.add(bufferGas).mul(gasPrice)
  } catch (error) {
    logger.error(error)
  }
}

interface EstimateTxOptions {
  token: Token
  network?: Chain
  sourceChain?: Chain
  destinationChain?: Chain
  deadline?: () => number
  checkAllowance?: boolean
}

export function useEstimateTxCost() {
  const { sdk } = useApp()
  const [tx, setTx] = useState<Transaction | null>(null)

  // TODO: convert all to react-query
  const estimateConvertTokens = useCallback(
    async (options: { token: Token; network: Chain; destinationChain: Chain }) => {
      const { token, network, destinationChain } = options

      if (!(sdk && network && destinationChain?.slug)) {
        return
      }

      const bridge = sdk.bridge(token.symbol)

      const estimatedGasLimit = await bridge.estimateSendHTokensGasLimit(
        '420',
        network.slug,
        destinationChain.slug,
        {
          bonderFee: '0',
        }
      )

      if (estimatedGasLimit) {
        let gasCost = await getGasCostByGasLimit(network.provider, estimatedGasLimit)
        if (gasCost && network.slug === ChainSlug.Optimism) {
          const tokenAmount = BigNumber.from(1)
          const { data, to } = await bridge.populateSendHTokensTx(
            tokenAmount,
            network.slug,
            destinationChain.slug
          )
          const l1FeeInWei = await bridge.estimateOptimismL1FeeFromData(estimatedGasLimit, data, to)
          gasCost = gasCost.add(l1FeeInWei)
        }
        return gasCost
      }
    },
    [sdk]
  )

  const estimateSend = useCallback(
    async (options: EstimateTxOptions) => {
      const { sourceChain, destinationChain, token, deadline, checkAllowance } = options
      if (!(sdk && sourceChain && destinationChain && deadline && token)) {
        return
      }

      try {
        const bridge = sdk.bridge(token.symbol)
        console.log(`bridge:`, bridge)

        const destinationAmountOutMin = 0
        let destinationDeadline = deadline()
        if (destinationChain.slug === ChainSlug.Ethereum) {
          destinationDeadline = 0
        }

        const needsAppoval = await token.needsApproval(
          bridge.getSendApprovalAddress(sourceChain.slug),
          '10'
        )

        console.log(`needsApproval:`, needsAppoval)

        let estimatedGasLimit = BigNumber.from(200e3)
        // Get estimated gas limit
        if (!needsAppoval) {
          estimatedGasLimit = await bridge.estimateSendGasLimit(
            '10',
            sourceChain.slug as string,
            destinationChain.slug as string,
            {
              recipient: constants.AddressZero,
              bonderFee: '1',
              amountOutMin: '0',
              deadline: deadline(),
              destinationAmountOutMin,
              destinationDeadline,
            }
          )
        }

        if (estimatedGasLimit) {
          let gasCost = await getGasCostByGasLimit(sourceChain.provider, estimatedGasLimit)
          if (gasCost && sourceChain.slug === ChainSlug.Optimism) {
            const l1FeeInWei = await bridge.getOptimismL1Fee(sourceChain.slug, destinationChain.slug)
            gasCost = gasCost.add(l1FeeInWei)
          }
          return gasCost
        }
      } catch (error: any) {
        logger.error(formatError(error))
      }
    },
    [sdk]
  )

  const estimateWrap = useCallback(async (options: EstimateTxOptions) => {
    const { token, network } = options
    if (!(network && token)) {
      return
    }

    try {
      // Get estimated gas cost
      const estimatedGasLimit = await token.getWrapTokenEstimatedGas(network.slug)

      if (BigNumber.isBigNumber(estimatedGasLimit)) {
        let gasCost = await getGasCostByGasLimit(network.provider, estimatedGasLimit)
        if (gasCost && network?.slug === ChainSlug.Optimism) {
          const { gasLimit, data, to } = await token.getWrapTokenEstimatedGas(network.slug)
          const l1FeeInWei = await token.estimateOptimismL1FeeFromData(gasLimit, data, to)
          gasCost = gasCost.add(l1FeeInWei)
        }
        return gasCost
      }
    } catch (error) {
      logger.error(formatError(error))
    }
  }, [])

  // Master send method
  const estimateMaxValue = useCallback(
    async (methodName: string, options?: any) => {
      if (!methodName) {
        return
      }

      try {
        switch (methodName) {
          case MethodNames.convertTokens: {
            return estimateConvertTokens(options)
          }

          case MethodNames.wrapToken: {
            return estimateWrap(options)
          }

          default:
            break
        }
      } catch (error) {
        logger.error(formatError(error))
      }
    },
    [sdk]
  )

  return {
    estimateMaxValue,
    estimateSend,
    tx,
    setTx,
  }
}
