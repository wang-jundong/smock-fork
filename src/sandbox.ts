import hre from 'hardhat';
import VM from '@nomiclabs/ethereumjs-vm';
import { BaseContract } from 'ethers';
import { FakeContract, FakeContractOptions, FakeContractSpec, MockContract } from './types';
import { makeRandomAddress, getHardhatBaseProvider } from './utils';
import { ObservableVM } from './observable-vm';
import { createMockContract, createFakeContract } from './factories/lopt-contract';
import { ethersInterfaceFromSpec } from './factories/ethers-interface';

// Handle hardhat ^2.4.0
let decodeRevertReason: (value: Buffer) => string;
try {
  decodeRevertReason = require('hardhat/internal/hardhat-network/stack-traces/revert-reasons').decodeRevertReason;
} catch (err) {
  const { ReturnData } = require('hardhat/internal/hardhat-network/provider/return-data');
  decodeRevertReason = (value: Buffer) => {
    const returnData = new ReturnData(value);
    return returnData.isErrorReturnData() ? returnData.decodeError() : '';
  };
}

// Handle hardhat ^2.2.0
let TransactionExecutionError: any;
try {
  TransactionExecutionError = require('hardhat/internal/hardhat-network/provider/errors').TransactionExecutionError;
} catch (err) {
  TransactionExecutionError = require('hardhat/internal/core/providers/errors').TransactionExecutionError;
}

export class Sandbox {
  private vm: ObservableVM;
  private static nonce: number = 0;

  constructor(vm: VM) {
    this.vm = new ObservableVM(vm);
  }

  async fake<Type extends BaseContract>(spec: FakeContractSpec, opts: FakeContractOptions = {}): Promise<FakeContract<Type>> {
    return createFakeContract(
      this.vm,
      opts.address || makeRandomAddress(),
      await ethersInterfaceFromSpec(spec),
      opts.provider || hre.ethers.provider
    );
  }

  async mock<Contract extends BaseContract>(contract: Contract): Promise<MockContract<Contract>> {
    return createMockContract(this.vm, contract);
  }

  static async create(): Promise<Sandbox> {
    // Only support native hardhat runtime, haven't bothered to figure it out for anything else.
    if (hre.network.name !== 'hardhat') {
      throw new Error(`Lopt is only compatible with the "hardhat" network, got: ${hre.network.name}`);
    }

    const provider: any = await getHardhatBaseProvider(hre);
    const node = provider._node;

    // Initialize VM it case it hasn't been already
    if (node === undefined) {
      await provider._init();
    }

    // Here we're fixing with hardhat's internal error management. Smock is a bit weird and messes
    // with stack traces so we need to help hardhat out a bit when it comes to smock-specific errors.
    const originalManagerErrorsFn = node._manageErrors.bind(node);
    node._manageErrors = async (vmResult: any, vmTrace: any, vmTracerError?: any): Promise<any> => {
      if (vmResult.exceptionError && vmResult.exceptionError.error === 'lopt revert') {
        return new TransactionExecutionError(`VM Exception while processing transaction: revert ${decodeRevertReason(vmResult.returnValue)}`);
      }

      return originalManagerErrorsFn(vmResult, vmTrace, vmTracerError);
    };

    return new Sandbox(provider._node._vm as VM);
  }

  static getNextNonce(): number {
    return Sandbox.nonce++;
  }
}