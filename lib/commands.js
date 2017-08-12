/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
const parseTreeTraverser_1 = require("./parseTreeTraverser");
const symbol_1 = require("./symbol");
const useDeclarationHelper_1 = require("./useDeclarationHelper");
class NameTextEditProvider {
    constructor(symbolStore, docStore) {
        this.symbolStore = symbolStore;
        this.docStore = docStore;
    }
    provideContractFqnTextEdits(uri, position, alias) {
        let edits = [];
        let doc = this.docStore.find(uri);
        let table = this.symbolStore.getSymbolTable(uri);
        if (!doc) {
            return edits;
        }
        let fqnNode = this._fullyQualifiedNamePhrase(position, doc, table);
        let symbol = this.symbolStore.find(doc.nodeText(fqnNode)).shift();
        if (!symbol) {
            return edits;
        }
        let helper = new useDeclarationHelper_1.UseDeclarationHelper(doc, table, position);
        let fqnUseSymbol = helper.findUseSymbolByFqn(symbol.name);
        let nameUseSymbol = helper.findUseSymbolByName(symbol_1.PhpSymbol.notFqn(symbol.name));
        if (!fqnUseSymbol) {
            if (!alias && nameUseSymbol) {
                //declaration will clash with an existing import
                return edits;
            }
            edits.push(helper.insertDeclarationTextEdit(symbol, alias));
        }
        else if (alias && fqnUseSymbol.name !== alias) {
            //replace existing 
            edits.push(helper.replaceDeclarationTextEdit(symbol, alias));
        }
        let name = alias || symbol_1.PhpSymbol.notFqn(symbol.name);
        const kindMask = 1 /* Class */ | 2 /* Interface */ | 4 /* Trait */ | 64 /* Function */ | 8 /* Constant */ | 2048 /* Constructor */;
        let lcName = symbol.name.toLowerCase();
        let fn = (r) => {
            return (r.kind & kindMask) > 0 && lcName === r.name.toLowerCase();
        };
        let references = table.references(fn);
        for (let n = 0, l = references.length; n < l; ++n) {
            edits.push(vscode_languageserver_types_1.TextEdit.replace(references[n].location.range, name));
        }
        return edits.reverse();
    }
    _fullyQualifiedNamePhrase(position, doc, table) {
        let traverser = new parseTreeTraverser_1.ParseTreeTraverser(doc, table);
        traverser.position(position);
        let fqnNode = traverser.ancestor(this._isFullyQualifiedName);
        if (!fqnNode && position.character > 0) {
            traverser.position(vscode_languageserver_types_1.Position.create(position.line, position.character - 1));
            return traverser.ancestor(this._isFullyQualifiedName);
        }
        else {
            return fqnNode;
        }
    }
    _isFullyQualifiedName(node) {
        return node.phraseType === 84 /* FullyQualifiedName */;
    }
}
exports.NameTextEditProvider = NameTextEditProvider;
