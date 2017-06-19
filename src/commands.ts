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
import { Phrase, PhraseType } from 'php7parser';
import { MultiVisitor } from './types';
import * as util from './util';

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

    let filterFn = (x: Reference) => {
        return x.symbol === refAtPos.symbol;
    };

    let filteredReferences = references.filter(filterFn);
    let context = new Context(this.symbolStore, doc, position);
    nameResolver = context.nameResolver;

    let existingRule = nameResolver.rules.find((x) => {
        let assoc = x.associated.find((z) => {
            return z.kind === (<PhpSymbol>refAtPos.symbol).kind && z.name === (<PhpSymbol>refAtPos.symbol).name;
        });
        return assoc !== undefined;
    });

    let aliasRequired = false;
    let name = PhpSymbol.notFqn((<PhpSymbol>refAtPos.symbol).name);
    let lcName = name.toLowerCase();

    if (!existingRule) {
        //is an alias needed?
        aliasRequired = nameResolver.rules.find((x) => {
            return x.name.toLowerCase() === lcName;
        }) !== undefined;

        //import rule text edit
        let appendAfterRange: lsp.Range;
        let editText = '';

        if (context.lastNamespaceUseDeclaration) {
            appendAfterRange = this.document.nodeRange(context.lastNamespaceUseDeclaration);
            editText = '\n' + util.whitespace(appendAfterRange.start.character);
        } else if (context.namespaceDefinition && !ParsedDocument.firstPhraseOfType(PhraseType.StatementList, context.namespaceDefinition.children)) {
            appendAfterRange = this.document.nodeRange(context.namespaceDefinition);
            editText = '\n\n' + util.whitespace(appendAfterRange.start.character);
        } else if (context.openingInlineText) {
            appendAfterRange = this.document.nodeRange(context.openingInlineText);
            editText = '\n' + util.whitespace(appendAfterRange.start.character);
        }

        editText += 'use';

        switch ((<PhpSymbol>refAtPos.symbol).kind) {
            case SymbolKind.Function:
                editText += ' function';
                break;
            case SymbolKind.Constant:
                editText = ' const';
                break;
            default:
                break;
        }

        editText += ' ' + (<PhpSymbol>refAtPos.symbol).name;

        if (aliasRequired) {
            editText += ' as ';
        }

        if (appendAfterRange) {
            edits.push(lsp.TextEdit.insert(appendAfterRange.end, editText));
        }

    }

    let ref: Reference;
    if (aliasRequired) {
        name = '';
    }
    for (let n = 0, l = filteredReferences.length; n < l; ++n) {
        ref = filteredReferences[n];
        edits.push(lsp.TextEdit.replace(ref.range, name));
    }

    return {
        edits: edits.reverse(),
        aliasRequired: aliasRequired
    };

}
