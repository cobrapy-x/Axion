// SPDX-License-Identifier: Apache-2.0
import { bjtSwitch } from '../../physics/transistor';

/** 2N2222: collector and emitter connect while the base is forward biased (switching model). */
export default bjtSwitch('npn');
