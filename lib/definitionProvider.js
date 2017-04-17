/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const parsedDocument_1 = require("./parsedDocument");
const context_1 = require("./context");
class DefinitionProvider {
    constructor(symbolStore, documentStore) {
        this.symbolStore = symbolStore;
        this.documentStore = documentStore;
    }
    provideDefinition(uri, position) {
        let doc = this.documentStore.find(uri);
        if (!doc) {
            return null;
        }
        let context = new context_1.Context(this.symbolStore, doc, position);
        let traverser = context.createTraverser();
        let phrase;
        let symbol;
        let name;
        while (phrase = traverser.parent()) {
            symbol = this._lookupSymbol(traverser.clone(), context);
            if (symbol) {
                break;
            }
        }
        return symbol && symbol.location ? symbol.location : null;
    }
    _lookupSymbol(traverser, context) {
        let phrase = traverser.node;
        switch (phrase.phraseType) {
            case 155 /* SimpleVariable */:
                return this._simpleVariable(traverser, context);
            case 150 /* ScopedMemberName */:
                return this._scopedMemberName(traverser, context);
            case 110 /* MemberName */:
                return this._memberName(traverser, context);
            case 120 /* NamespaceName */:
                return this._namespaceName(traverser, context);
            default:
                return null;
        }
    }
    _isConstFuncClassTraitInterface(s) {
        switch (s.kind) {
            case 1 /* Class */:
            case 4 /* Trait */:
            case 2 /* Interface */:
            case 8 /* Constant */:
            case 64 /* Function */:
                return s.location !== undefined && s.location !== null;
            default:
                return false;
        }
    }
    _namespaceName(traverser, context) {
        let t2 = traverser.clone();
        if (this._isNamePhrase(t2.parent())) {
            return this._qualifiedName(t2, context);
        }
        //probably namespace use decl
        return this.symbolStore.find(context.nodeText(traverser.node, [161 /* Whitespace */]), this._isConstFuncClassTraitInterface);
    }
    _qualifiedName(traverser, context) {
        let kind = 1 /* Class */;
        let phrase = traverser.node;
        let parent = traverser.parent();
        if (parsedDocument_1.ParsedDocument.isPhrase(parent, [41 /* ConstantAccessExpression */])) {
            kind = 8 /* Constant */;
        }
        else if (parsedDocument_1.ParsedDocument.isPhrase(parent, [84 /* FunctionCallExpression */])) {
            kind = 64 /* Function */;
        }
        let name = context.resolveFqn(phrase, kind);
        return this.symbolStore.find(name, this._isConstFuncClassTraitInterface);
    }
    _scopedMemberName(traverser, context) {
        let memberNamePhrase = traverser.node;
        if (!parsedDocument_1.ParsedDocument.isPhrase(memberNamePhrase.name, [94 /* Identifier */]) &&
            !parsedDocument_1.ParsedDocument.isToken(memberNamePhrase.name, [84 /* VariableName */])) {
            return null;
        }
        let parent = traverser.parent();
        let memberName = context.nodeText(memberNamePhrase.name);
        let typeNames = context.resolveExpressionType(parent.scope).atomicClassArray();
        let pred = (x) => {
            return memberName === x.name && !!x.location;
        };
        let queries = typeNames.map((x) => {
            return { typeName: x, memberPredicate: pred };
        });
        return this.symbolStore.lookupMemberOnTypes(queries);
    }
    _memberName(traverser, context) {
        let memberNamePhrase = traverser.node;
        if (!parsedDocument_1.ParsedDocument.isToken(memberNamePhrase.name, [83 /* Name */])) {
            return null;
        }
        let parent = traverser.parent();
        let memberName = context.tokenText(memberNamePhrase.name);
        let typeNames = context.resolveExpressionType(parent.variable).atomicClassArray();
        if (parent.phraseType === 135 /* PropertyAccessExpression */) {
            memberName = '$' + memberName;
        }
        let pred = (x) => {
            return memberName === x.name && !!x.location;
        };
        let queries = typeNames.map((x) => {
            return { typeName: x, memberPredicate: pred };
        });
        return this.symbolStore.lookupMemberOnTypes(queries);
    }
    _simpleVariable(traverser, context) {
        let phrase = traverser.node;
        if (!parsedDocument_1.ParsedDocument.isToken(phrase.name, [84 /* VariableName */])) {
            return null;
        }
        let varName = context.tokenText(phrase.name);
        let scopeSymbol = context.scopeSymbol;
        let pred = (x) => {
            return x.name === varName;
        };
        return scopeSymbol.children.find(pred);
    }
    _isNamePhrase(node) {
        if (!node) {
            return false;
        }
        switch (node.phraseType) {
            case 140 /* QualifiedName */:
            case 83 /* FullyQualifiedName */:
            case 143 /* RelativeQualifiedName */:
                return true;
            default:
                return false;
        }
    }
}
exports.DefinitionProvider = DefinitionProvider;
