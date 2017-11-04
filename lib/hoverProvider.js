/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const symbol_1 = require("./symbol");
class HoverProvider {
    constructor(docStore, symbolStore, refStore) {
        this.docStore = docStore;
        this.symbolStore = symbolStore;
        this.refStore = refStore;
    }
    provideHover(uri, pos) {
        let doc = this.docStore.find(uri);
        let table = this.refStore.getReferenceTable(uri);
        if (!doc || !table) {
            return undefined;
        }
        let ref = table.referenceAtPosition(pos);
        if (!ref) {
            return undefined;
        }
        let symbol = this.symbolStore.findSymbolsByReference(ref, 1 /* Override */).shift();
        if (!symbol) {
            return undefined;
        }
        switch (symbol.kind) {
            case 64 /* Function */:
            case 32 /* Method */:
                return {
                    contents: symbol_1.PhpSymbol.signatureString(symbol),
                    range: ref.location.range
                };
            case 128 /* Parameter */:
            case 16 /* Property */:
                return {
                    contents: [symbol_1.PhpSymbol.type(symbol), symbol.name].join(' ').trim(),
                    range: ref.location.range
                };
            case 256 /* Variable */:
                return {
                    contents: [ref.type, symbol.name].join(' ').trim(),
                    range: ref.location.range
                };
            default:
                return undefined;
        }
    }
}
exports.HoverProvider = HoverProvider;
