import {
  listCapabilityDescriptors,
  listCapabilityStatuses,
  getCapabilityStatus,
  emergencyStop
} from './registry';

export const CAPABILITIES = listCapabilityDescriptors();

export {
  listCapabilityDescriptors,
  listCapabilityStatuses,
  getCapabilityStatus,
  emergencyStop
};
