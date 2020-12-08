pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./L2_Bridge.sol";

contract L2_OptimismBridge is L2_Bridge {
    mockOVM_CrossDomainMessenger public messenger;

    constructor (mockOVM_CrossDomainMessenger _messenger) public L2_Bridge() {
        messenger = _messenger;
    }

    function getChainId() public override pure returns (uint256) {
        return 420;
    }

    function _sendMessageToL1Bridge(bytes memory _message) internal override {
        messenger.sendMessage(
            l1BridgeAddress,
            _message,
            200000
        );
    }
}
