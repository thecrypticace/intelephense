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

export function importSymbol(
    symbolStore: SymbolStore,
    documentStore: ParsedDocumentStore,
    uri: string,
    position: lsp.Position,
    alias?: string
): lsp.TextEdit[] {

    let edits: lsp.TextEdit[] = [];
    let doc = documentStore.find(uri);

    if (!doc) {
        return edits;
    }

    let nameResolver = new NameResolver();
    let nameResolverVisitor = new NameResolverVisitor(doc, nameResolver);
    let referenceVisitor = new ReferenceVisitor(doc, nameResolver, symbolStore);
    let visitor = new MultiVisitor([
        nameResolverVisitor, referenceVisitor
    ]);

    doc.traverse(visitor);
    let references = referenceVisitor.references;
    //console.log(JSON.stringify(references, null, 4));
    let refAtPos = references.referenceAtPosition(position);
    //console.log(JSON.stringify(refAtPos, null, 4));

    if (
        !refAtPos ||
        !((<PhpSymbol>refAtPos.symbol).kind & (SymbolKind.Class | SymbolKind.Interface | SymbolKind.Constant | SymbolKind.Function))
    ) {
        return edits;
    }

    let filterFn = (x: Reference) => {
        return x.symbol === refAtPos.symbol;
    };

    let filteredReferences = references.filter(filterFn);
    let context = new Context(symbolStore, doc, position);
    nameResolver = context.nameResolver;

    let existingRule = nameResolver.rules.find((x) => {
        let assoc = x.associated.find((z) => {
            return z.kind === (<PhpSymbol>refAtPos.symbol).kind && z.name === (<PhpSymbol>refAtPos.symbol).name;
        });
        return assoc !== undefined;
    });

    let name: string;
    if (existingRule) {
        name = existingRule.name;
    } else if (alias) {
        name = alias;
    } else {
        name = PhpSymbol.notFqn((<PhpSymbol>refAtPos.symbol).name);
    }

    if (!existingRule) {

        let importText = 'use';

        switch ((<PhpSymbol>refAtPos.symbol).kind) {
            case SymbolKind.Function:
                importText += ' function';
                break;
            case SymbolKind.Constant:
                importText = ' const';
                break;
            default:
                break;
        }

        importText += ' ' + (<PhpSymbol>refAtPos.symbol).name;

        if (alias) {
            importText += ' as ' + alias;
        }

        importText += ';';

        let appendAfterRange: lsp.Range;

        //placement of use decl fallback
        if (context.lastNamespaceUseDeclaration) {
            appendAfterRange = doc.nodeRange(context.lastNamespaceUseDeclaration);
            importText = '\n' + util.whitespace(appendAfterRange.start.character) + importText;
        } else if (context.namespaceDefinition && !ParsedDocument.firstPhraseOfType(PhraseType.StatementList, context.namespaceDefinition.children)) {
            appendAfterRange = doc.nodeRange(context.namespaceDefinition);
            importText = '\n\n' + util.whitespace(appendAfterRange.start.character) + importText;
        } else if (context.openingInlineText) {
            appendAfterRange = doc.nodeRange(context.openingInlineText);
            importText = '\n' + util.whitespace(appendAfterRange.start.character) + importText;
        }

        if (appendAfterRange) {
            edits.push(lsp.TextEdit.insert(appendAfterRange.end, importText));
        } else {
            return edits;
        }

    }

    for (let n = 0, l = filteredReferences.length; n < l; ++n) {
        edits.push(lsp.TextEdit.replace(filteredReferences[n].range, name));
    }

    return edits.reverse();

}
