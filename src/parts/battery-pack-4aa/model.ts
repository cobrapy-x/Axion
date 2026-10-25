// SPDX-License-Identifier: Apache-2.0
import { fixedSource } from '../../physics/source';

/** '+' is 6 V above '-' (an ideal source: it never runs flat). */
export default fixedSource(6);
