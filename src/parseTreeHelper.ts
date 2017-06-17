/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { Phrase, PhraseType } from 'php7parser';
import { SymbolKind } from './symbol';

export namespace ParseTreeHelper {

    export function phraseToReferencesSymbolKind(node: Phrase) {

        if (!node) {
            return SymbolKind.Class;
        }

        switch (node.phraseType) {
            case PhraseType.ConstantAccessExpression:
                return SymbolKind.Constant;
            case PhraseType.FunctionCallExpression:
                return SymbolKind.Function;
            default:
                return SymbolKind.Class;
        }
    }


}