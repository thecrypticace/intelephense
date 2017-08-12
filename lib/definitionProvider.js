/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const parseTreeTraverser_1 = require("./parseTreeTraverser");
class DefinitionProvider {
    constructor(symbolStore, documentStore) {
        this.symbolStore = symbolStore;
        this.documentStore = documentStore;
    }
    provideDefinition(uri, position) {
        let doc = this.documentStore.find(uri);
        let table = this.symbolStore.getSymbolTable(uri);
        if (!doc || !table) {
            return null;
        }
        let traverser = new parseTreeTraverser_1.ParseTreeTraverser(doc, table);
        traverser.position(position);
        let ref = traverser.reference;
        if (!ref) {
            return null;
        }
        let symbols = this.symbolStore.findSymbolsByReference(ref, 1 /* Override */);
        let locations = [];
        let s;
        let loc;
        for (let n = 0; n < symbols.length; ++n) {
            s = symbols[n];
            if (s.location && (loc = this.symbolStore.identifierLocation(s))) {
                locations.push(loc);
            }
        }
        return locations.length === 1 ? locations[0] : locations;
    }
}
exports.DefinitionProvider = DefinitionProvider;
