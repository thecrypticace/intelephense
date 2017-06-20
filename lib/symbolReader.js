/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const nameResolverVisitor_1 = require("./nameResolverVisitor");
const types_1 = require("./types");
const parsedDocument_1 = require("./parsedDocument");
const phpDoc_1 = require("./phpDoc");
const symbol_1 = require("./symbol");
const typeString_1 = require("./typeString");
class SymbolReader extends types_1.MultiVisitor {
    constructor(nameResolverVisitor, symbolVisitor) {
        super([nameResolverVisitor, symbolVisitor]);
        this._symbolVisitor = symbolVisitor;
    }
    set externalOnly(v) {
        this._symbolVisitor.externalOnly = v;
    }
    get spine() {
        return this._symbolVisitor.spine;
    }
    static create(document, nameResolver, spine) {
        return new SymbolReader(new nameResolverVisitor_1.NameResolverVisitor(document, nameResolver), new SymbolVisitor(document, nameResolver, spine));
    }
}
exports.SymbolReader = SymbolReader;
class SymbolVisitor {
    constructor(document, nameResolver, spine) {
        this.document = document;
        this.nameResolver = nameResolver;
        this.spine = spine;
        this.namespaceUseDeclarationPrefix = '';
        this.externalOnly = false;
    }
    preorder(node, spine) {
        let s;
        switch (node.phraseType) {
            case 119 /* NamespaceDefinition */:
                s = this.namespaceDefinition(node);
                this._addSymbol(s, false);
                return true;
            case 123 /* NamespaceUseDeclaration */:
                this.namespaceUseDeclarationKind = this._tokenToSymbolKind(node.kind);
                this.namespaceUseDeclarationPrefix = this.document.nodeText(node.prefix);
                return true;
            case 121 /* NamespaceUseClause */:
                s = this.namespaceUseClause(node, this.namespaceUseDeclarationKind, this.namespaceUseDeclarationPrefix);
                this._addSymbol(s, false);
                return false;
            case 43 /* ConstElement */:
                this._addSymbol(this.constElement(node, this.lastPhpDoc), false);
                return false;
            case 85 /* FunctionDeclaration */:
                this._addSymbol(this.functionDeclaration(node, this.lastPhpDoc), true);
                return true;
            case 87 /* FunctionDeclarationHeader */:
                this.functionDeclarationHeader(this._top(), node);
                return true;
            case 128 /* ParameterDeclaration */:
                this._addSymbol(this.parameterDeclaration(node, this.lastPhpDoc), true);
                return true;
            case 172 /* TypeDeclaration */:
                s = this.spine[this.spine.length - 1];
                let typeDeclarationValue = this.typeDeclaration(node);
                if (typeDeclarationValue) {
                    s.type = new typeString_1.TypeString(typeDeclarationValue); //type hints trump phpdoc
                    s.typeSource = 1 /* TypeDeclaration */;
                }
                return false;
            case 28 /* ClassDeclaration */:
                this._addSymbol(this.classDeclaration(node, this.lastPhpDoc, this.lastPhpDocLocation), true);
                return true;
            case 30 /* ClassDeclarationHeader */:
                this.classDeclarationHeader(this.spine[this.spine.length - 1], node);
                return true;
            case 23 /* ClassBaseClause */:
                s = this.spine[this.spine.length - 1];
                let classBaseClause = this.classBaseClause(node);
                if (s.associated) {
                    s.associated.push(classBaseClause);
                }
                else {
                    s.associated = [classBaseClause];
                }
                return false;
            case 31 /* ClassInterfaceClause */:
                s = this.spine[this.spine.length - 1];
                let classInterfaceClause = this.classInterfaceClause(node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, classInterfaceClause);
                }
                else {
                    s.associated = classInterfaceClause;
                }
                return false;
            case 102 /* InterfaceDeclaration */:
                this._addSymbol(this.interfaceDeclaration(node, this.lastPhpDoc, this.lastPhpDocLocation), true);
                return true;
            case 104 /* InterfaceDeclarationHeader */:
                this.interfaceDeclarationHeader(this._top(), node);
                return false;
            case 101 /* InterfaceBaseClause */:
                s = this.spine[this.spine.length - 1];
                let interfaceBaseClause = this.interfaceBaseClause(node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, interfaceBaseClause);
                }
                else {
                    s.associated = interfaceBaseClause;
                }
                return false;
            case 164 /* TraitDeclaration */:
                this._addSymbol(this.traitDeclaration(node, this.lastPhpDoc, this.lastPhpDocLocation), true);
                return true;
            case 166 /* TraitDeclarationHeader */:
                this.spine[this.spine.length - 1].name =
                    this.traitDeclarationHeader(node);
                return false;
            case 25 /* ClassConstDeclaration */:
                this.classConstDeclarationModifier =
                    this.classConstantDeclaration(node);
                return true;
            case 26 /* ClassConstElement */:
                this._addSymbol(this.classConstElement(this.classConstDeclarationModifier, node, this.lastPhpDoc), false);
                return false;
            case 136 /* PropertyDeclaration */:
                this.propertyDeclarationModifier =
                    this.propertyDeclaration(node);
                return true;
            case 137 /* PropertyElement */:
                this._addSymbol(this.propertyElement(this.propertyDeclarationModifier, node, this.lastPhpDoc), false);
                return false;
            case 169 /* TraitUseClause */:
                s = this.spine[this.spine.length - 1];
                let traitUseClause = this.traitUseClause(node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, traitUseClause);
                }
                else {
                    s.associated = traitUseClause;
                }
                return false;
            case 112 /* MethodDeclaration */:
                this._addSymbol(this.methodDeclaration(node, this.lastPhpDoc), true);
                return true;
            case 114 /* MethodDeclarationHeader */:
                this.methodDeclarationHeader(this._top(), node);
                return true;
            case 2 /* AnonymousClassDeclaration */:
                this._addSymbol(this.anonymousClassDeclaration(node), true);
                return true;
            case 4 /* AnonymousFunctionCreationExpression */:
                this._addSymbol(this.anonymousFunctionCreationExpression(node), true);
                return true;
            case 7 /* AnonymousFunctionUseVariable */:
                this._addSymbol(this.anonymousFunctionUseVariable(node), false);
                return false;
            case 155 /* SimpleVariable */:
                if (!this._shouldReadVar(spine)) {
                    return false;
                }
                s = this.simpleVariable(node);
                if (s && SymbolVisitor._globalVars.indexOf(s.name) < 0 && !this._variableExists(s.name)) {
                    this._addSymbol(s, false);
                }
                return false;
            case 20 /* CatchClause */:
                s = {
                    kind: 256 /* Variable */,
                    name: this.document.nodeText(node.variable),
                    location: this.document.nodeLocation(node.variable)
                };
                if (!this._variableExists(s.name)) {
                    this._addSymbol(s, false);
                }
                return true;
            case 86 /* FunctionDeclarationBody */:
            case 113 /* MethodDeclarationBody */:
                return !this.externalOnly;
            case 84 /* FunctionCallExpression */:
                //define
                s = this.functionCallExpression(node);
                if (s) {
                    this._addSymbol(s, false);
                }
                return false;
            case undefined:
                this._token(node);
                return false;
            default:
                return true;
        }
    }
    postorder(node, spine) {
        switch (node.phraseType) {
            case 85 /* FunctionDeclaration */:
            case 128 /* ParameterDeclaration */:
            case 28 /* ClassDeclaration */:
            case 102 /* InterfaceDeclaration */:
            case 164 /* TraitDeclaration */:
            case 112 /* MethodDeclaration */:
            case 2 /* AnonymousClassDeclaration */:
            case 4 /* AnonymousFunctionCreationExpression */:
                this.spine.pop();
                break;
            case 136 /* PropertyDeclaration */:
                this.propertyDeclarationModifier = 0;
                break;
            case 25 /* ClassConstDeclaration */:
                this.classConstDeclarationModifier = 0;
                break;
            case 123 /* NamespaceUseDeclaration */:
                this.namespaceUseDeclarationKind = 0;
                this.namespaceUseDeclarationPrefix = '';
                break;
            case 87 /* FunctionDeclarationHeader */:
            case 114 /* MethodDeclarationHeader */:
            case 30 /* ClassDeclarationHeader */:
            case 104 /* InterfaceDeclarationHeader */:
            case 166 /* TraitDeclarationHeader */:
            case 5 /* AnonymousFunctionHeader */:
            case 3 /* AnonymousClassDeclarationHeader */:
                this.lastPhpDoc = null;
                this.lastPhpDocLocation = null;
                break;
            default:
                break;
        }
    }
    _tokenToSymbolKind(t) {
        if (!t) {
            return 0 /* None */;
        }
        switch (t.tokenType) {
            case 35 /* Function */:
                return 64 /* Function */;
            case 12 /* Const */:
                return 8 /* Constant */;
            default:
                return 0 /* None */;
        }
    }
    _shouldReadVar(spine) {
        for (let n = spine.length - 1; n >= 0; --n) {
            if (SymbolVisitor._varAncestors.indexOf(spine[n].phraseType) > -1) {
                return true;
            }
        }
        return false;
    }
    _top() {
        return this.spine[this.spine.length - 1];
    }
    _variableExists(name) {
        let parent = this.spine[this.spine.length - 1];
        if (!parent.children) {
            return false;
        }
        let mask = 128 /* Parameter */ | 256 /* Variable */;
        let s;
        for (let n = 0, l = parent.children.length; n < l; ++n) {
            s = parent.children[n];
            if ((s.kind & mask) > 0 && s.name === name) {
                return true;
            }
        }
        return false;
    }
    _token(t) {
        switch (t.tokenType) {
            case 160 /* DocumentComment */:
                let phpDocTokenText = this.document.nodeText(t);
                this.lastPhpDoc = phpDoc_1.PhpDocParser.parse(phpDocTokenText);
                this.lastPhpDocLocation = this.document.nodeLocation(t);
                break;
            case 119 /* CloseBrace */:
                this.lastPhpDoc = null;
                this.lastPhpDocLocation = null;
                break;
            default:
                break;
        }
    }
    _addSymbol(symbol, pushToSpine) {
        if (!symbol) {
            return;
        }
        let parent = this.spine[this.spine.length - 1];
        if (!parent.children) {
            parent.children = [];
        }
        if (parent.name) {
            symbol.scope = parent.name;
        }
        parent.children.push(symbol);
        if (pushToSpine) {
            this.spine.push(symbol);
        }
    }
    argListToStringArray(node) {
        let textArray = [];
        for (let n = 0, l = node.elements.length; n < l; ++n) {
            textArray.push(this.document.nodeText(node.elements[n]));
        }
        return textArray;
    }
    functionCallExpression(node) {
        let fnName = this.document.nodeText(node.callableExpr);
        if (fnName.length && fnName[0] === '\\') {
            fnName = fnName.slice(1);
        }
        if (fnName.toLowerCase() !== 'define' || !node.argumentList) {
            return null;
        }
        let argTextArray = this.argListToStringArray(node.argumentList);
        let name = argTextArray.shift().slice(1, -1);
        if (name && name[0] === '\\') {
            name = name.slice(1);
        }
        let value = argTextArray.shift();
        return {
            kind: 8 /* Constant */,
            name: name,
            value: value
        };
    }
    nameTokenToFqn(t) {
        return this.nameResolver.resolveRelative(this.document.nodeText(t));
    }
    functionDeclaration(node, phpDoc) {
        let s = {
            kind: 64 /* Function */,
            name: '',
            location: this.document.nodeLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new typeString_1.TypeString(returnTag.typeString).nameResolve(this.nameResolver);
            }
        }
        return s;
    }
    functionDeclarationHeader(s, node) {
        s.name = this.nameTokenToFqn(node.name);
        return s;
    }
    parameterDeclaration(node, phpDoc) {
        let s = {
            kind: 128 /* Parameter */,
            name: this.document.nodeText(node.name),
            location: this.document.nodeLocation(node)
        };
        if (phpDoc) {
            let tag = phpDoc.findParamTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new typeString_1.TypeString(tag.typeString).nameResolve(this.nameResolver);
            }
        }
        if (node.value) {
            s.value = this.document.nodeText(node.value);
        }
        return s;
    }
    typeDeclaration(node) {
        if (!node.name) {
            return '';
        }
        if (parsedDocument_1.ParsedDocument.isPhrase(node)) {
            let text = this._namePhraseToFqn(node.name, 1 /* Class */);
            let notFqn = symbol_1.PhpSymbol.notFqn(text);
            if (SymbolVisitor._builtInTypes.indexOf(notFqn) > -1) {
                return notFqn;
            }
            return text;
        }
        else {
            return this.document.nodeText(node.name);
        }
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
    constElement(node, phpDoc) {
        let s = {
            kind: 8 /* Constant */,
            name: this.nameTokenToFqn(node.name),
            location: this.document.nodeLocation(node),
            value: this.document.nodeText(node.value)
        };
        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new typeString_1.TypeString(tag.typeString).nameResolve(this.nameResolver);
            }
        }
        return s;
    }
    classConstantDeclaration(node) {
        return node.modifierList ?
            SymbolReader.modifierListElementsToSymbolModifier(node.modifierList.elements) :
            1 /* Public */;
    }
    classConstElement(modifiers, node, phpDoc) {
        let s = {
            kind: 1024 /* ClassConstant */,
            modifiers: modifiers,
            name: this.document.nodeText(node.name),
            location: this.document.nodeLocation(node),
            value: this.document.nodeText(node.value)
        };
        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new typeString_1.TypeString(tag.typeString).nameResolve(this.nameResolver);
            }
        }
        return s;
    }
    methodDeclaration(node, phpDoc) {
        let s = {
            kind: 32 /* Method */,
            name: '',
            location: this.document.nodeLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new typeString_1.TypeString(returnTag.typeString).nameResolve(this.nameResolver);
            }
        }
        return s;
    }
    memberModifierList(node) {
        return SymbolReader.modifierListElementsToSymbolModifier(node.elements);
    }
    methodDeclarationHeader(s, node) {
        s.name = this.identifier(node.name);
        if (node.modifierList) {
            s.modifiers = this.memberModifierList(node.modifierList);
        }
        return s;
    }
    propertyDeclaration(node) {
        return node.modifierList ?
            SymbolReader.modifierListElementsToSymbolModifier(node.modifierList.elements) :
            0 /* None */;
    }
    propertyElement(modifiers, node, phpDoc) {
        let s = {
            kind: 16 /* Property */,
            name: this.document.nodeText(node.name),
            modifiers: modifiers,
            location: this.document.nodeLocation(node)
        };
        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new typeString_1.TypeString(tag.typeString).nameResolve(this.nameResolver);
            }
        }
        return s;
    }
    identifier(node) {
        return this.document.nodeText(node.name);
    }
    interfaceDeclaration(node, phpDoc, phpDocLoc) {
        let s = {
            kind: 2 /* Interface */,
            name: '',
            location: this.document.nodeLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, this.phpDocMembers(phpDoc, phpDocLoc));
        }
        return s;
    }
    phpDocMembers(phpDoc, phpDocLoc) {
        let magic = phpDoc.propertyTags;
        let symbols = [];
        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(this.propertyTagToSymbol(magic[n], phpDocLoc));
        }
        magic = phpDoc.methodTags;
        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(this.methodTagToSymbol(magic[n], phpDocLoc));
        }
        return symbols;
    }
    methodTagToSymbol(tag, phpDocLoc) {
        let s = {
            kind: 32 /* Method */,
            modifiers: 256 /* Magic */,
            name: tag.name,
            type: new typeString_1.TypeString(tag.typeString).nameResolve(this.nameResolver),
            description: tag.description,
            children: [],
            location: phpDocLoc
        };
        if (!tag.parameters) {
            return s;
        }
        for (let n = 0, l = tag.parameters.length; n < l; ++n) {
            s.children.push(this.magicMethodParameterToSymbol(tag.parameters[n], phpDocLoc));
        }
        return s;
    }
    magicMethodParameterToSymbol(p, phpDocLoc) {
        return {
            kind: 128 /* Parameter */,
            name: p.name,
            modifiers: 256 /* Magic */,
            type: new typeString_1.TypeString(p.typeString).nameResolve(this.nameResolver),
            location: phpDocLoc
        };
    }
    propertyTagToSymbol(t, phpDocLoc) {
        return {
            kind: 16 /* Property */,
            name: t.name,
            modifiers: this.magicPropertyModifier(t) | 256 /* Magic */,
            type: new typeString_1.TypeString(t.typeString).nameResolve(this.nameResolver),
            description: t.description,
            location: phpDocLoc
        };
    }
    magicPropertyModifier(t) {
        switch (t.tagName) {
            case '@property-read':
                return 64 /* ReadOnly */;
            case '@property-write':
                return 128 /* WriteOnly */;
            default:
                return 0 /* None */;
        }
    }
    interfaceDeclarationHeader(s, node) {
        s.name = this.nameTokenToFqn(node.name);
        return s;
    }
    interfaceBaseClause(node) {
        let mapFn = (name) => {
            return {
                kind: 2 /* Interface */,
                name: name
            };
        };
        return this.qualifiedNameList(node.nameList).map(mapFn);
    }
    traitDeclaration(node, phpDoc, phpDocLoc) {
        let s = {
            kind: 4 /* Trait */,
            name: '',
            location: this.document.nodeLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, this.phpDocMembers(phpDoc, phpDocLoc));
        }
        return s;
    }
    traitDeclarationHeader(node) {
        return this.nameTokenToFqn(node.name);
    }
    classDeclaration(node, phpDoc, phpDocLoc) {
        let s = {
            kind: 1 /* Class */,
            name: '',
            location: this.document.nodeLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, this.phpDocMembers(phpDoc, phpDocLoc));
        }
        return s;
    }
    classDeclarationHeader(s, node) {
        if (node.modifier) {
            s.modifiers = SymbolReader.modifierTokenToSymbolModifier(node.modifier);
        }
        s.name = this.nameTokenToFqn(node.name);
        return s;
    }
    classBaseClause(node) {
        return {
            kind: 1 /* Class */,
            name: this._namePhraseToFqn(node.name, 1 /* Class */)
        };
    }
    stringToInterfaceSymbolStub(text) {
        return {
            kind: 2 /* Interface */,
            name: text
        };
    }
    classInterfaceClause(node) {
        return this.qualifiedNameList(node.nameList).map(this.stringToInterfaceSymbolStub);
    }
    stringToTraitSymbolStub(text) {
        return {
            kind: 4 /* Trait */,
            name: text
        };
    }
    traitUseClause(node) {
        return this.qualifiedNameList(node.nameList).map(this.stringToTraitSymbolStub);
    }
    anonymousClassDeclaration(node) {
        return {
            kind: 1 /* Class */,
            name: this.document.createAnonymousName(node),
            modifiers: 512 /* Anonymous */,
            location: this.document.nodeLocation(node)
        };
    }
    anonymousFunctionCreationExpression(node) {
        return {
            kind: 64 /* Function */,
            name: this.document.createAnonymousName(node),
            modifiers: 512 /* Anonymous */,
            location: this.document.nodeLocation(node)
        };
    }
    anonymousFunctionUseVariable(node) {
        return {
            kind: 256 /* Variable */,
            name: this.document.nodeText(node.name),
            location: this.document.nodeLocation(node),
            modifiers: 4096 /* Use */
        };
    }
    simpleVariable(node) {
        if (!parsedDocument_1.ParsedDocument.isToken(node.name, [84 /* VariableName */])) {
            return null;
        }
        return {
            kind: 256 /* Variable */,
            name: this.document.nodeText(node.name),
            location: this.document.nodeLocation(node)
        };
    }
    qualifiedNameList(node) {
        let names = [];
        let name;
        if (!node) {
            return names;
        }
        for (let n = 0, l = node.elements.length; n < l; ++n) {
            name = this._namePhraseToFqn(node.elements[n], 1 /* Class */);
            if (name) {
                names.push(name);
            }
        }
        return names;
    }
    namespaceUseClause(node, kind, prefix) {
        let fqn = this.nameResolver.concatNamespaceName(prefix, this.document.nodeText(node.name));
        if (!kind) {
            kind = 1 /* Class */;
        }
        return {
            kind: kind,
            name: node.aliasingClause ? this.document.nodeText(node.aliasingClause.alias) : symbol_1.PhpSymbol.notFqn(fqn),
            associated: [{ kind: kind, name: fqn }],
            location: this.document.nodeLocation(node),
            modifiers: 4096 /* Use */
        };
    }
    namespaceDefinition(node) {
        return {
            kind: 512 /* Namespace */,
            name: this.document.nodeText(node.name),
            location: this.document.nodeLocation(node),
            children: []
        };
    }
}
SymbolVisitor._varAncestors = [
    107 /* ListIntrinsic */, 76 /* ForeachKey */, 78 /* ForeachValue */,
    16 /* ByRefAssignmentExpression */, 38 /* CompoundAssignmentExpression */,
    154 /* SimpleAssignmentExpression */
];
SymbolVisitor._builtInTypes = [
    'array', 'callable', 'int', 'string', 'bool', 'float'
];
SymbolVisitor._globalVars = [
    '$GLOBALS',
    '$_SERVER',
    '$_GET',
    '$_POST',
    '$_FILES',
    '$_REQUEST',
    '$_SESSION',
    '$_ENV',
    '$_COOKIE',
    '$php_errormsg',
    '$HTTP_RAW_POST_DATA',
    '$http_response_header',
    '$argc',
    '$argv',
    '$this'
];
exports.SymbolVisitor = SymbolVisitor;
(function (SymbolReader) {
    function modifierListElementsToSymbolModifier(tokens) {
        let flag = 0 /* None */;
        if (!tokens || tokens.length < 1) {
            return flag;
        }
        for (let n = 0, l = tokens.length; n < l; ++n) {
            flag |= this.modifierTokenToSymbolModifier(tokens[n]);
        }
        return flag;
    }
    SymbolReader.modifierListElementsToSymbolModifier = modifierListElementsToSymbolModifier;
    function modifierTokenToSymbolModifier(t) {
        switch (t.tokenType) {
            case 55 /* Public */:
                return 1 /* Public */;
            case 56 /* Protected */:
                return 2 /* Protected */;
            case 54 /* Private */:
                return 4 /* Private */;
            case 2 /* Abstract */:
                return 16 /* Abstract */;
            case 31 /* Final */:
                return 8 /* Final */;
            case 60 /* Static */:
                return 32 /* Static */;
            default:
                return 0 /* None */;
        }
    }
    SymbolReader.modifierTokenToSymbolModifier = modifierTokenToSymbolModifier;
})(SymbolReader = exports.SymbolReader || (exports.SymbolReader = {}));
