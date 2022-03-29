import { ChainName, ChainSlug, Errors, NetworkSlug, Slug } from '../constants'
import { metadata } from '../config'
import { providers } from 'ethers'

type Provider = providers.Provider

class Chain {
  chainId: number
  name: ChainName | string = ''
  slug: Slug | string = ''
  provider: Provider | null = null
  isL1: boolean = false
  nativeTokenSymbol: string

  static Ethereum = newChain(ChainSlug.Ethereum, metadata.networks.ethereum.chainId)
  static Optimism = newChain(ChainSlug.Optimism, metadata.networks.optimism.chainId)
  static Arbitrum = newChain(ChainSlug.Arbitrum, metadata.networks.arbitrum.chainId)
  static Gnosis = newChain(ChainSlug.Gnosis, metadata.networks.gnosis.chainId)
  static Polygon = newChain(ChainSlug.Polygon, metadata.networks.polygon.chainId)

  static fromSlug (slug: Slug | string) {
    if (slug === 'xdai') {
      console.warn(Errors.xDaiRebrand)
      slug = 'gnosis'
    }

    return newChain(slug)
  }

  constructor (name: ChainName | string, chainId?: number, provider?: Provider) {
    this.name = name
    this.slug = (name || '').trim().toLowerCase()
    if (
      this.slug === NetworkSlug.Kovan ||
      this.slug === NetworkSlug.Goerli ||
      this.slug === NetworkSlug.Mainnet ||
      this.slug === NetworkSlug.Staging ||
      this.slug === ChainSlug.Ethereum
    ) {
      this.isL1 = true
      this.slug = ChainSlug.Ethereum
    }
    if (chainId) {
      this.chainId = chainId
    }
    if (provider) {
      this.provider = provider
    }

    this.nativeTokenSymbol = metadata.networks[this.slug].nativeTokenSymbol
  }

  equals (other: Chain) {
    return this.slug === other.slug
  }

  get rpcUrl () {
    return (this.provider as any)?.connection?.url
  }
}

function newChain (chain: NetworkSlug | ChainSlug | string, chainId?: number) {
  if (
    chain === NetworkSlug.Mainnet ||
    chain === NetworkSlug.Staging ||
    chain === NetworkSlug.Goerli ||
    chain === NetworkSlug.Kovan
  ) {
    chain = ChainSlug.Ethereum
  }
  if (!metadata.networks[chain]) {
    throw new Error(`unsupported chain "${chain}"`)
  }
  return new Chain(metadata.networks[chain].name, chainId)
}

export default Chain
