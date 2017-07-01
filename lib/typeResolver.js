/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const parsedDocument_1 = require("./parsedDocument");
const typeString_1 = require("./typeString");
const types_1 = require("./types");
const nameResolverVisitor_1 = require("./nameResolverVisitor");
const phpDoc_1 = require("./phpDoc");
class ExpressionTypeResolver {
    constructor(document, nameResolver, symbolStore, variableTable) {
        this.document = document;
        this.nameResolver = nameResolver;
        this.symbolStore = symbolStore;
        this.variableTable = variableTable;
    }
    resolveExpression(node) {
        if (!node) {
            return '';
        }
        switch (node.phraseType) {
            case 155 /* SimpleVariable */:
                return this.simpleVariable(node);
            case 159 /* SubscriptExpression */:
                return this.subscriptExpression(node);
            case 149 /* ScopedCallExpression */:
                return this.scopedMemberAccessExpression(node, 32 /* Method */);
            case 151 /* ScopedPropertyAccessExpression */:
                return this.scopedMemberAccessExpression(node, 16 /* Property */);
            case 135 /* PropertyAccessExpression */:
                return this.instanceMemberAccessExpression(node, 16 /* Property */);
            case 111 /* MethodCallExpression */:
                return this.instanceMemberAccessExpression(node, 32 /* Method */);
            case 84 /* FunctionCallExpression */:
                return this.functionCallExpression(node);
            case 40 /* TernaryExpression */:
                return this.ternaryExpression(node);
            case 154 /* SimpleAssignmentExpression */:
            case 16 /* ByRefAssignmentExpression */:
                return this.resolveExpression(node.right);
            case 127 /* ObjectCreationExpression */:
                return this.objectCreationExpression(node);
            case 34 /* ClassTypeDesignator */:
            case 100 /* InstanceofTypeDesignator */:
                return this.classTypeDesignator(node);
            case 2 /* AnonymousClassDeclaration */:
                return this.document.createAnonymousName(node);
            case 140 /* QualifiedName */:
            case 83 /* FullyQualifiedName */:
            case 143 /* RelativeQualifiedName */:
                return this._namePhraseToFqn(node, 1 /* Class */);
            case 144 /* RelativeScope */:
                return this.nameResolver.className;
            case 37 /* CoalesceExpression */:
                return typeString_1.TypeString.merge(this.resolveExpression(node.left), this.resolveExpression(node.right));
            default:
                return '';
        }
    }
    ternaryExpression(node) {
        return typeString_1.TypeString.merge(this.resolveExpression(node.trueExpr), this.resolveExpression(node.falseExpr));
    }
    scopedMemberAccessExpression(node, kind) {
        let memberName = this.scopedMemberName(node.memberName);
        let scopeTypeString = this.resolveExpression(node.scope);
        if (!scopeTypeString || !memberName) {
            return '';
        }
        let typeNames = typeString_1.TypeString.atomicClassArray(scopeTypeString);
        let symbols = this.lookupMemberOnTypes(typeNames, kind, memberName, 32 /* Static */, 0);
        return this.mergeTypes(symbols);
    }
    lookupMemberOnTypes(typeNames, kind, memberName, modifierMask, notModifierMask) {
        let symbols = [];
        let s;
        let visibilityNotModifierMask = 0;
        let typeName;
        for (let n = 0, l = typeNames.length; n < l; ++n) {
            typeName = typeNames[n];
            if (typeName === this.nameResolver.className) {
                visibilityNotModifierMask = 0;
            }
            else if (typeName === this.nameResolver.classBaseName) {
                visibilityNotModifierMask = 4 /* Private */;
            }
            else {
                visibilityNotModifierMask = 4 /* Private */ | 2 /* Protected */;
            }
            let memberPredicate = (x) => {
                return x.kind === kind &&
                    (!modifierMask || (x.modifiers & modifierMask) > 0) &&
                    !(visibilityNotModifierMask & x.modifiers) &&
                    !(notModifierMask & x.modifiers) &&
                    x.name === memberName;
            };
            s = this.symbolStore.lookupTypeMember({ typeName: typeName, memberPredicate: memberPredicate });
            if (s) {
                symbols.push(s);
            }
        }
        return symbols;
    }
    scopedMemberName(node) {
        if (node && parsedDocument_1.ParsedDocument.isToken(node.name, [84 /* VariableName */])) {
            return this.document.tokenText(node.name);
        }
        else if (node && parsedDocument_1.ParsedDocument.isPhrase(node.name, [94 /* Identifier */])) {
            return this.document.tokenText(node.name.name);
        }
        return '';
    }
    classTypeDesignator(node) {
        if (node && parsedDocument_1.ParsedDocument.isPhrase(node.type, [140 /* QualifiedName */, 83 /* FullyQualifiedName */, 143 /* RelativeQualifiedName */])) {
            return this._namePhraseToFqn(node.type, 1 /* Class */);
        }
        else if (node && parsedDocument_1.ParsedDocument.isPhrase(node.type, [144 /* RelativeScope */])) {
            return this.nameResolver.className;
        }
        else {
            return '';
        }
    }
    objectCreationExpression(node) {
        if (parsedDocument_1.ParsedDocument.isPhrase(node.type, [2 /* AnonymousClassDeclaration */])) {
            return this.document.createAnonymousName(node);
        }
        else if (parsedDocument_1.ParsedDocument.isPhrase(node.type, [34 /* ClassTypeDesignator */])) {
            return this.classTypeDesignator(node.type);
        }
        else {
            return '';
        }
    }
    simpleVariable(node) {
        if (parsedDocument_1.ParsedDocument.isToken(node.name, [84 /* VariableName */])) {
            return this.variableTable.getType(this.document.tokenText(node.name), this.nameResolver.className);
        }
        return '';
    }
    subscriptExpression(node) {
        let type = this.resolveExpression(node.dereferencable);
        return typeString_1.TypeString.arrayDereference(type);
    }
    functionCallExpression(node) {
        let qName = node.callableExpr;
        if (!parsedDocument_1.ParsedDocument.isPhrase(qName, [83 /* FullyQualifiedName */, 140 /* QualifiedName */, 143 /* RelativeQualifiedName */])) {
            return '';
        }
        let functionName = this._namePhraseToFqn(qName, 64 /* Function */);
        let symbol = this.symbolStore.find(functionName, (x) => { return x.kind === 64 /* Function */; });
        return symbol && symbol.type ? symbol.type : '';
    }
    memberName(node) {
        return node ? this.document.tokenText(node.name) : '';
    }
    instanceMemberAccessExpression(node, kind) {
        let memberName = parsedDocument_1.ParsedDocument.isToken(node.memberName) ?
            this.document.tokenText(node.memberName) :
            this.memberName(node.memberName);
        let type = this.resolveExpression(node.variable);
        if (!memberName || !type) {
            return '';
        }
        if (kind === 16 /* Property */) {
            memberName = '$' + memberName;
        }
        let symbols = this.lookupMemberOnTypes(typeString_1.TypeString.atomicClassArray(type), kind, memberName, 0, 32 /* Static */);
        return this.mergeTypes(symbols);
    }
    mergeTypes(symbols) {
        let type = '';
        let symbol;
        for (let n = 0, l = symbols.length; n < l; ++n) {
            type = typeString_1.TypeString.merge(type, symbols[n].type);
        }
        return type;
    }
    _namePhraseToFqn(node, kind) {
        if (!node) {
            return '';
        }
        switch (node.phraseType) {
            case 140 /* QualifiedName */:
                return this.nameResolver.resolveNotFullyQualified(this.document.namespaceNamePhraseToString(node.name), kind);
            case 143 /* RelativeQualifiedName */:
                return this.nameResolver.resolveRelative(this.document.namespaceNamePhraseToString(node.name));
            case 83 /* FullyQualifiedName */:
                return this.document.namespaceNamePhraseToString(node.name);
            case 120 /* NamespaceName */:
                return this.document.namespaceNamePhraseToString(node);
            default:
                return '';
        }
    }
}
exports.ExpressionTypeResolver = ExpressionTypeResolver;
class VariableTypeResolver extends types_1.MultiVisitor {
    constructor(nameResolverVisitor, variableTypeVisitor) {
        super([nameResolverVisitor, variableTypeVisitor]);
        this._nameResolverVisitor = nameResolverVisitor;
        this._variableTypeVisitor = variableTypeVisitor;
    }
    set haltAtOffset(offset) {
        this._variableTypeVisitor.haltAtOffset = offset;
    }
    get variableTable() {
        return this._variableTypeVisitor.variableTable;
    }
    static create(document, nameResolver, symbolStore, variableTable) {
        return new VariableTypeResolver(new nameResolverVisitor_1.NameResolverVisitor(document, nameResolver), new VariableTypeVisitor(document, nameResolver, symbolStore, variableTable));
    }
}
exports.VariableTypeResolver = VariableTypeResolver;
class VariableTypeVisitor {
    constructor(document, nameResolver, symbolStore, variableTable) {
        this.document = document;
        this.nameResolver = nameResolver;
        this.symbolStore = symbolStore;
        this.variableTable = variableTable;
        this.haltTraverse = false;
        this.haltAtOffset = -1;
    }
    preorder(node, spine) {
        switch (node.phraseType) {
            case 85 /* FunctionDeclaration */:
                this._methodOrFunction(node, 64 /* Function */);
                return true;
            case 112 /* MethodDeclaration */:
                this._methodOrFunction(node, 32 /* Method */);
                return true;
            case 28 /* ClassDeclaration */:
            case 164 /* TraitDeclaration */:
            case 102 /* InterfaceDeclaration */:
            case 2 /* AnonymousClassDeclaration */:
                this.variableTable.pushScope();
                return true;
            case 4 /* AnonymousFunctionCreationExpression */:
                this._anonymousFunctionCreationExpression(node);
                return true;
            case 95 /* IfStatement */:
            case 17 /* CaseStatement */:
            case 48 /* DefaultStatement */:
            case 53 /* ElseIfClause */:
                this.variableTable.pushBranch();
                return true;
            case 52 /* ElseClause */:
                let elseClauseParent = spine[spine.length - 1];
                if (!elseClauseParent.elseIfClauseList) {
                    this.variableTable.popBranch();
                }
                this.variableTable.pushBranch();
                return true;
            case 54 /* ElseIfClauseList */:
                this.variableTable.popBranch(); //pop the if branch
                return true;
            case 154 /* SimpleAssignmentExpression */:
            case 16 /* ByRefAssignmentExpression */:
                if (parsedDocument_1.ParsedDocument.isPhrase(node.left, [155 /* SimpleVariable */, 107 /* ListIntrinsic */])) {
                    this._assignmentExpression(node);
                    if (this.haltAtOffset > -1 && parsedDocument_1.ParsedDocument.isOffsetInNode(this.haltAtOffset, node)) {
                        this.haltTraverse = true;
                    }
                    return false;
                }
                return true;
            case 99 /* InstanceOfExpression */:
                this._instanceOfExpression(node);
                if (this.haltAtOffset > -1 && parsedDocument_1.ParsedDocument.isOffsetInNode(this.haltAtOffset, node)) {
                    this.haltTraverse = true;
                }
                return false;
            case 77 /* ForeachStatement */:
                this._foreachStatement(node);
                return true;
            case 20 /* CatchClause */:
                this._catchClause(node);
                return true;
            case undefined:
                this._token(node);
                return false;
            default:
                return true;
        }
    }
    postorder(node, spine) {
        switch (node.phraseType) {
            case 95 /* IfStatement */:
                if (!node.elseClause && !node.elseIfClauseList) {
                    this.variableTable.popBranch();
                }
                this.variableTable.pruneBranches();
                break;
            case 160 /* SwitchStatement */:
                this.variableTable.pruneBranches();
                break;
            case 17 /* CaseStatement */:
            case 48 /* DefaultStatement */:
            case 52 /* ElseClause */:
            case 53 /* ElseIfClause */:
                this.variableTable.popBranch();
                break;
            case 85 /* FunctionDeclaration */:
            case 112 /* MethodDeclaration */:
            case 28 /* ClassDeclaration */:
            case 164 /* TraitDeclaration */:
            case 102 /* InterfaceDeclaration */:
            case 2 /* AnonymousClassDeclaration */:
            case 4 /* AnonymousFunctionCreationExpression */:
                this.variableTable.popScope();
                break;
            default:
                break;
        }
    }
    _qualifiedNameList(node) {
        let fqns = [];
        for (let n = 0, l = node.elements.length; n < l; ++n) {
            fqns.push(this._namePhraseToFqn(node.elements[n], 1 /* Class */));
        }
        return fqns.join('|');
    }
    _namePhraseToFqn(node, kind) {
        if (!node) {
            return '';
        }
        let text = this.document.nodeText(node.name, [159 /* Comment */, 161 /* Whitespace */]);
        switch (node.phraseType) {
            case 140 /* QualifiedName */:
                return this.nameResolver.resolveNotFullyQualified(text, kind);
            case 143 /* RelativeQualifiedName */:
                return this.nameResolver.resolveRelative(text);
            case 83 /* FullyQualifiedName */:
                return text;
            default:
                return '';
        }
    }
    _catchClause(node) {
        this.variableTable.setType(this.document.tokenText(node.variable), this._qualifiedNameList(node.nameList));
    }
    _listIntrinsic(node) {
        let elements = node.initialiserList.elements;
        let element;
        let varNames = [];
        let varName;
        for (let n = 0, l = elements.length; n < l; ++n) {
            element = elements[n];
            varName = this._simpleVariable(element.value.expr);
            if (varName) {
                varNames.push(varName);
            }
        }
        return varNames;
    }
    _token(t) {
        //doc block type hints
        if (t.tokenType === 160 /* DocumentComment */) {
            let phpDoc = phpDoc_1.PhpDocParser.parse(this.document.tokenText(t));
            if (phpDoc) {
                let varTags = phpDoc.varTags;
                let varTag;
                for (let n = 0, l = varTags.length; n < l; ++n) {
                    varTag = varTags[n];
                    this.variableTable.setType(varTag.name, typeString_1.TypeString.nameResolve(varTag.typeString, this.nameResolver));
                }
            }
        }
        if (this.haltAtOffset > -1 && parsedDocument_1.ParsedDocument.isOffsetInToken(this.haltAtOffset, t)) {
            this.haltTraverse = true;
        }
    }
    _parameterSymbolFilter(s) {
        return s.kind === 128 /* Parameter */;
    }
    _methodOrFunction(node, kind) {
        this.variableTable.pushScope();
        let symbol = this._findSymbolForPhrase(node);
        if (symbol) {
            let params = symbol.children.filter(this._parameterSymbolFilter);
            let param;
            for (let n = 0, l = params.length; n < l; ++n) {
                param = params[n];
                this.variableTable.setType(param.name, param.type);
            }
        }
    }
    _findSymbolForPhrase(p) {
        let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
        let range = this.document.nodeRange(p);
        let predicate = (x) => {
            return x.location &&
                x.location.range.start.line === range.start.line &&
                x.location.range.start.character === range.start.character;
        };
        return symbolTable.find(predicate);
    }
    _anonymousFunctionUseVariableSymbolFilter(s) {
        return s.kind === 256 /* Variable */ && (s.modifiers & 4096 /* Use */) > 0;
    }
    _anonymousFunctionCreationExpression(node) {
        let symbol = this._findSymbolForPhrase(node);
        let carry = [];
        if (symbol && symbol.children) {
            let useVariables = symbol.children.filter(this._anonymousFunctionUseVariableSymbolFilter);
            for (let n = 0, l = useVariables.length; n < l; ++n) {
                carry.push(useVariables[n].name);
            }
        }
        this.variableTable.pushScope(carry);
    }
    _simpleVariable(node) {
        return this._isNonDynamicSimpleVariable(node) ? this.document.tokenText(node.name) : '';
    }
    _instanceOfExpression(node) {
        let lhs = node.left;
        let rhs = node.right;
        let varName = this._simpleVariable(lhs);
        let exprTypeResolver = new ExpressionTypeResolver(this.document, this.nameResolver, this.symbolStore, this.variableTable);
        this.variableTable.setType(varName, exprTypeResolver.resolveExpression(rhs));
    }
    _isNonDynamicSimpleVariable(node) {
        return parsedDocument_1.ParsedDocument.isPhrase(node, [155 /* SimpleVariable */]) &&
            parsedDocument_1.ParsedDocument.isToken(node.name, [84 /* VariableName */]);
    }
    _assignmentExpression(node) {
        let lhs = node.left;
        let rhs = node.right;
        let exprTypeResolver = new ExpressionTypeResolver(this.document, this.nameResolver, this.symbolStore, this.variableTable);
        let type;
        if (parsedDocument_1.ParsedDocument.isPhrase(lhs, [155 /* SimpleVariable */])) {
            let varName = this._simpleVariable(lhs);
            type = exprTypeResolver.resolveExpression(rhs);
            this.variableTable.setType(varName, type);
        }
        else if (parsedDocument_1.ParsedDocument.isPhrase(node, [107 /* ListIntrinsic */])) {
            let varNames = this._listIntrinsic(rhs);
            this.variableTable.setTypeMany(varNames, typeString_1.TypeString.arrayDereference(exprTypeResolver.resolveExpression(rhs)));
        }
    }
    _foreachStatement(node) {
        let collection = node.collection;
        let value = node.value;
        let exprResolver = new ExpressionTypeResolver(this.document, this.nameResolver, this.symbolStore, this.variableTable);
        let type = typeString_1.TypeString.arrayDereference(exprResolver.resolveExpression(collection.expr));
        if (parsedDocument_1.ParsedDocument.isPhrase(value.expr, [155 /* SimpleVariable */])) {
            let varName = this._simpleVariable(value.expr);
            this.variableTable.setType(varName, type);
        }
        else if (parsedDocument_1.ParsedDocument.isPhrase(value.expr, [107 /* ListIntrinsic */])) {
            let varNames = this._listIntrinsic(value.expr);
            this.variableTable.setTypeMany(varNames, typeString_1.TypeString.arrayDereference(type));
        }
    }
}
exports.VariableTypeVisitor = VariableTypeVisitor;
class VariableTable {
    constructor() {
        this._typeVariableSetStack = [{
                kind: 1 /* Scope */,
                variables: {},
                branches: []
            }];
    }
    setType(varName, type) {
        if (!varName || !type) {
            return;
        }
        this._top().variables[varName] = { name: varName, type: type };
    }
    setTypeMany(varNames, type) {
        for (let n = 0, l = varNames.length; n < l; ++n) {
            this.setType(varNames[n], type);
        }
    }
    pushScope(carry) {
        let scope = {
            kind: 1 /* Scope */,
            variables: {},
            branches: []
        };
        if (carry) {
            let type;
            for (let n = 0; n < carry.length; ++n) {
                type = this.getType(carry[n]);
                if (type) {
                    scope.variables[carry[n]] = { name: carry[n], type: type };
                }
            }
        }
        this._typeVariableSetStack.push(scope);
    }
    popScope() {
        this._typeVariableSetStack.pop();
    }
    pushBranch() {
        let b = {
            kind: 3 /* Branch */,
            variables: {},
            branches: []
        };
        this._top().branches.push(b);
        this._typeVariableSetStack.push(b);
    }
    popBranch() {
        this._typeVariableSetStack.pop();
    }
    /**
     * consolidates variables.
     * each variable can be any of types discovered in branches after this.
     */
    pruneBranches() {
        let node = this._top();
        let branches = node.branches;
        node.branches = [];
        for (let n = 0, l = branches.length; n < l; ++n) {
            this._mergeSets(node, branches[n]);
        }
    }
    getType(varName, className) {
        if (varName === '$this' && className) {
            return className;
        }
        let typeSet;
        for (let n = this._typeVariableSetStack.length - 1; n >= 0; --n) {
            typeSet = this._typeVariableSetStack[n];
            if (typeSet.variables[varName]) {
                return typeSet.variables[varName].type;
            }
            if (typeSet.kind === 1 /* Scope */) {
                break;
            }
        }
        return '';
    }
    _mergeSets(a, b) {
        let keys = Object.keys(b.variables);
        let typedVar;
        for (let n = 0, l = keys.length; n < l; ++n) {
            typedVar = b.variables[keys[n]];
            if (a.variables[typedVar.name]) {
                a.variables[typedVar.name].type = typeString_1.TypeString.merge(a.variables[typedVar.name].type, typedVar.type);
            }
            else {
                a.variables[typedVar.name] = typedVar;
            }
        }
    }
    _top() {
        return this._typeVariableSetStack[this._typeVariableSetStack.length - 1];
    }
}
exports.VariableTable = VariableTable;
