// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';

/** DC model: a capacitor blocks steady current, so it connects nothing. Charging is not simulated yet. */
const create: ModelFactory = () => ({});

export default create;
