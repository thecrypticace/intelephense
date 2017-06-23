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
function importSymbol(symbolStore, documentStore, uri, position, alias) {
    let edits = [];
    let doc = documentStore.find(uri);
    if (!doc) {
        return edits;
    }
    let nameResolver = new nameResolver_1.NameResolver();
    let nameResolverVisitor = new nameResolverVisitor_1.NameResolverVisitor(doc, nameResolver);
    let referenceVisitor = new references_1.ReferenceVisitor(doc, nameResolver, symbolStore);
    let visitor = new types_1.MultiVisitor([
        nameResolverVisitor, referenceVisitor
    ]);
    doc.traverse(visitor);
    let references = referenceVisitor.references;
    //console.log(JSON.stringify(references, null, 4));
    let refAtPos = references.referenceAtPosition(position);
    //console.log(JSON.stringify(refAtPos, null, 4));
    if (!refAtPos ||
        !(refAtPos.symbol.kind & (1 /* Class */ | 2 /* Interface */ | 8 /* Constant */ | 64 /* Function */))) {
        return edits;
    }
    let filterFn = (x) => {
        return x.symbol === refAtPos.symbol;
    };
    let filteredReferences = references.filter(filterFn);
    let context = new context_1.Context(symbolStore, doc, position);
    nameResolver = context.nameResolver;
    let existingRule = nameResolver.rules.find((x) => {
        let assoc = x.associated.find((z) => {
            return z.kind === refAtPos.symbol.kind && z.name === refAtPos.symbol.name;
        });
        return assoc !== undefined;
    });
    let name;
    if (existingRule) {
        name = existingRule.name;
    }
    else if (alias) {
        name = alias;
    }
    else {
        name = symbol_1.PhpSymbol.notFqn(refAtPos.symbol.name);
    }
    if (!existingRule) {
        let importText = 'use';
        switch (refAtPos.symbol.kind) {
            case 64 /* Function */:
                importText += ' function';
                break;
            case 8 /* Constant */:
                importText = ' const';
                break;
            default:
                break;
        }
        importText += ' ' + refAtPos.symbol.name;
        if (alias) {
            importText += ' as ' + alias;
        }
        importText += ';';
        let appendAfterRange;
        //placement of use decl fallback
        if (context.lastNamespaceUseDeclaration) {
            appendAfterRange = doc.nodeRange(context.lastNamespaceUseDeclaration);
            importText = '\n' + util.whitespace(appendAfterRange.start.character) + importText;
        }
        else if (context.namespaceDefinition && !parsedDocument_1.ParsedDocument.firstPhraseOfType(156 /* StatementList */, context.namespaceDefinition.children)) {
            appendAfterRange = doc.nodeRange(context.namespaceDefinition);
            importText = '\n\n' + util.whitespace(appendAfterRange.start.character) + importText;
        }
        else if (context.openingInlineText) {
            appendAfterRange = doc.nodeRange(context.openingInlineText);
            importText = '\n' + util.whitespace(appendAfterRange.start.character) + importText;
        }
        if (appendAfterRange) {
            edits.push(lsp.TextEdit.insert(appendAfterRange.end, importText));
        }
        else {
            return edits;
        }
    }
    for (let n = 0, l = filteredReferences.length; n < l; ++n) {
        edits.push(lsp.TextEdit.replace(filteredReferences[n].range, name));
    }
    return edits.reverse();
}
exports.importSymbol = importSymbol;
