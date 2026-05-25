import {
  listCapabilityDescriptors,
  listCapabilityStatuses,
  listCapabilityRuntimeStatuses,
  getCapabilityStatus,
  emergencyStop
} from './registry';

export const CAPABILITIES = listCapabilityDescriptors();

export {
  listCapabilityDescriptors,
  listCapabilityStatuses,
  listCapabilityRuntimeStatuses,
  getCapabilityStatus,
  emergencyStop
};
