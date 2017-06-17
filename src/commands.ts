/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { Context } from './context';
import { SymbolStore } from './symbolStore';
import { SymbolKind } from './symbol';
import { ReferenceReader } from './references';
import { NameResolver } from './nameResolver';
import { VariableTable } from './typeResolver';
import { ParseTreeHelper } from './parseTreeHelper';

export interface ImportSymbolTextEdits {
    edits: lsp.TextEdit[];
    /**
     * If true an alias is required and is expected to be appended to each text edit
     */
    aliasRequired?: boolean;
}

export function importSymbol(
    symbolStore: SymbolStore,
    documentStore: ParsedDocumentStore,
    textDocument: lsp.TextDocumentIdentifier,
    position: lsp.Position
): ImportSymbolTextEdits {

    let edits: lsp.TextEdit[] = [];
    let doc = documentStore.find(textDocument.uri);

    if (!doc) {
        return { edits: edits };
    }

    let context = new Context(this.symbolStore, doc, position);
    let traverser = context.createTraverser();
    let qName = traverser.ancestor(ParsedDocument.isNamePhrase);

    if (!qName) {
        return { edits: edits };
    }

    let qNameParent = traverser.parent();
    let kind = SymbolKind.Class;


    let referenceReader = ReferenceReader.create(doc, new NameResolver(), this.symbolStore, new VariableTable());
    doc.traverse(referenceReader);
    let references = referenceReader.references;


}
