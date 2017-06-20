/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
var ParseTreeHelper;
(function (ParseTreeHelper) {
    function phraseToReferencesSymbolKind(node) {
        if (!node) {
            return 1 /* Class */;
        }
        switch (node.phraseType) {
            case 41 /* ConstantAccessExpression */:
                return 8 /* Constant */;
            case 84 /* FunctionCallExpression */:
                return 64 /* Function */;
            default:
                return 1 /* Class */;
        }
    }
    ParseTreeHelper.phraseToReferencesSymbolKind = phraseToReferencesSymbolKind;
})(ParseTreeHelper = exports.ParseTreeHelper || (exports.ParseTreeHelper = {}));
