// SPDX-License-Identifier: Apache-2.0
import { to220View } from '../../physics/to220-view';

export default to220View((props) => String(props.model ?? 'IRLZ44N'), 'N-MOSFET', ['G', 'D', 'S']);
