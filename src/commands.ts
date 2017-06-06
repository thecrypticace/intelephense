/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { Context } from './context';
import { SymbolStore } from './symbolStore';
import { SymbolKind } from './symbol';

export class ImportSymbolCommand {

    constructor(
        public docStore: ParsedDocumentStore,
        public symbolStore: SymbolStore
    ) { }

    execute(textDocument: lsp.TextDocumentIdentifier, position: lsp.Position): lsp.TextEdit[] {

        let edits: lsp.TextEdit[] = [];
        let doc = this.docStore.find(textDocument.uri);

        if (!doc) {
            return edits;
        }

        let context = new Context(this.symbolStore, doc, position);
        let traverser = context.createTraverser();
        let qName = traverser.ancestor(ParsedDocument.isNamePhrase);

        if (!qName) {
            return edits;
        }

        let qNameParent = traverser.parent();
        let kind = SymbolKind.Class;

    }

}
