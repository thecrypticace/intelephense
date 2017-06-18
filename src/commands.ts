/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { Context } from './context';
import { SymbolStore } from './symbolStore';
import { SymbolKind, PhpSymbol } from './symbol';
import { ReferenceVisitor, Reference } from './references';
import { NameResolver } from './nameResolver';
import { NameResolverVisitor } from './nameResolverVisitor';
import { VariableTable } from './typeResolver';
import { ParseTreeHelper } from './parseTreeHelper';
import { Phrase } from 'php7parser';
import { MultiVisitor } from './types';

export interface ImportSymbolTextEdits {
    edits: lsp.TextEdit[];
    /**
     * If true an alias is required and is expected to be appended to each TextEdit.newText
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

    let nameResolver = new NameResolver();
    let nameResolverVisitor = new NameResolverVisitor(doc, nameResolver);
    let referenceVisitor = new ReferenceVisitor(doc, nameResolver, symbolStore);
    let visitor = new MultiVisitor([
        nameResolverVisitor, referenceVisitor
    ]);

    doc.traverse(visitor);
    let references = referenceVisitor.references;
    let refAtPos = references.referenceAtPosition(position);

    if (
        !refAtPos ||
        !((<PhpSymbol>refAtPos.symbol).kind & (SymbolKind.Class | SymbolKind.Interface | SymbolKind.Constant | SymbolKind.Function))
    ) {
        return { edits: edits };
    }

    let filterFn = (x:Reference) => {
        return x.symbol === refAtPos.symbol;
    };

    let filteredReferences = references.filter(filterFn);
    let context = new Context(this.symbolStore, doc, position);
    nameResolver = context.nameResolver;
    
    let existingRule = nameResolver.rules.find((x)=>{
        let assoc = x.associated.find((s)=>{
            return s.kind === (<PhpSymbol>refAtPos.symbol).kind && s.name === (<PhpSymbol>refAtPos.symbol).name;
        });
        return assoc !== undefined;
    });

    let aliasRequired = false;
    let name = PhpSymbol.notFqn((<PhpSymbol>refAtPos.symbol).name);

    if(!existingRule) {
        //is an alias needed?
        nameResolver.rules.


    }

}
