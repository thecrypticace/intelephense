/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const lsp = require("vscode-languageserver-types");
const parsedDocument_1 = require("./parsedDocument");
const context_1 = require("./context");
const symbol_1 = require("./symbol");
const references_1 = require("./references");
const nameResolver_1 = require("./nameResolver");
const nameResolverVisitor_1 = require("./nameResolverVisitor");
const types_1 = require("./types");
const util = require("./util");
function importSymbol(symbolStore, documentStore, textDocument, position) {
    let edits = [];
    let doc = documentStore.find(textDocument.uri);
    if (!doc) {
        return { edits: edits };
    }
    let nameResolver = new nameResolver_1.NameResolver();
    let nameResolverVisitor = new nameResolverVisitor_1.NameResolverVisitor(doc, nameResolver);
    let referenceVisitor = new references_1.ReferenceVisitor(doc, nameResolver, symbolStore);
    let visitor = new types_1.MultiVisitor([
        nameResolverVisitor, referenceVisitor
    ]);
    doc.traverse(visitor);
    let references = referenceVisitor.references;
    let refAtPos = references.referenceAtPosition(position);
    if (!refAtPos ||
        !(refAtPos.symbol.kind & (1 /* Class */ | 2 /* Interface */ | 8 /* Constant */ | 64 /* Function */))) {
        return { edits: edits };
    }
    let filterFn = (x) => {
        return x.symbol === refAtPos.symbol;
    };
    let filteredReferences = references.filter(filterFn);
    let context = new context_1.Context(this.symbolStore, doc, position);
    nameResolver = context.nameResolver;
    let existingRule = nameResolver.rules.find((x) => {
        let assoc = x.associated.find((z) => {
            return z.kind === refAtPos.symbol.kind && z.name === refAtPos.symbol.name;
        });
        return assoc !== undefined;
    });
    let aliasRequired = false;
    let name = symbol_1.PhpSymbol.notFqn(refAtPos.symbol.name);
    let lcName = name.toLowerCase();
    if (!existingRule) {
        //is an alias needed?
        aliasRequired = nameResolver.rules.find((x) => {
            return x.name.toLowerCase() === lcName;
        }) !== undefined;
        //import rule text edit
        let appendAfterRange;
        let editText = '';
        if (context.lastNamespaceUseDeclaration) {
            appendAfterRange = this.document.nodeRange(context.lastNamespaceUseDeclaration);
            editText = '\n' + util.whitespace(appendAfterRange.start.character);
        }
        else if (context.namespaceDefinition && !parsedDocument_1.ParsedDocument.firstPhraseOfType(156 /* StatementList */, context.namespaceDefinition.children)) {
            appendAfterRange = this.document.nodeRange(context.namespaceDefinition);
            editText = '\n\n' + util.whitespace(appendAfterRange.start.character);
        }
        else if (context.openingInlineText) {
            appendAfterRange = this.document.nodeRange(context.openingInlineText);
            editText = '\n' + util.whitespace(appendAfterRange.start.character);
        }
        editText += 'use';
        switch (refAtPos.symbol.kind) {
            case 64 /* Function */:
                editText += ' function';
                break;
            case 8 /* Constant */:
                editText = ' const';
                break;
            default:
                break;
        }
        editText += ' ' + refAtPos.symbol.name;
        if (aliasRequired) {
            editText += ' as ';
        }
        if (appendAfterRange) {
            edits.push(lsp.TextEdit.insert(appendAfterRange.end, editText));
        }
    }
    let ref;
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
exports.importSymbol = importSymbol;
