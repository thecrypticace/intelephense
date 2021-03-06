/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const phpDoc_1 = require("./phpDoc");
const symbol_1 = require("./symbol");
const typeString_1 = require("./typeString");
const util = require("./util");
class SymbolReader {
    constructor(document, nameResolver) {
        this.document = document;
        this.nameResolver = nameResolver;
        this._uriHash = 0;
        this._transformStack = [new FileTransform(this.document.uri, this.document.nodeHashedLocation(this.document.tree))];
        this._uriHash = Math.abs(util.hash32(document.uri));
    }
    get symbol() {
        return this._transformStack[0].symbol;
    }
    preorder(node, spine) {
        let s;
        let parentNode = (spine.length ? spine[spine.length - 1] : { phraseType: 0 /* Unknown */, children: [] });
        let parentTransform = this._transformStack[this._transformStack.length - 1];
        switch (node.phraseType) {
            case 60 /* Error */:
                this._transformStack.push(null);
                return false;
            case 120 /* NamespaceDefinition */:
                {
                    let t = new NamespaceDefinitionTransform(this.document.nodeHashedLocation(node));
                    this._transformStack.push(t);
                    this.nameResolver.namespace = t.symbol;
                }
                break;
            case 124 /* NamespaceUseDeclaration */:
                this._transformStack.push(new NamespaceUseDeclarationTransform());
                break;
            case 123 /* NamespaceUseClauseList */:
            case 126 /* NamespaceUseGroupClauseList */:
                this._transformStack.push(new NamespaceUseClauseListTransform(node.phraseType));
                break;
            case 122 /* NamespaceUseClause */:
            case 125 /* NamespaceUseGroupClause */:
                {
                    let t = new NamespaceUseClauseTransform(node.phraseType, this.document.nodeHashedLocation(node));
                    this._transformStack.push(t);
                    this.nameResolver.rules.push(t.symbol);
                }
                break;
            case 119 /* NamespaceAliasingClause */:
                this._transformStack.push(new NamespaceAliasingClause());
                break;
            case 43 /* ConstElement */:
                this._transformStack.push(new ConstElementTransform(this.nameResolver, this.document.nodeHashedLocation(node), this.lastPhpDoc, this.lastPhpDocLocation));
                break;
            case 86 /* FunctionDeclaration */:
                this._transformStack.push(new FunctionDeclarationTransform(this.nameResolver, this.document.nodeHashedLocation(node), this.lastPhpDoc, this.lastPhpDocLocation));
                break;
            case 88 /* FunctionDeclarationHeader */:
                this._transformStack.push(new FunctionDeclarationHeaderTransform());
                break;
            case 130 /* ParameterDeclarationList */:
                this._transformStack.push(new DelimiteredListTransform(130 /* ParameterDeclarationList */));
                break;
            case 129 /* ParameterDeclaration */:
                this._transformStack.push(new ParameterDeclarationTransform(this.document.nodeHashedLocation(node), this.lastPhpDoc, this.lastPhpDocLocation, this.nameResolver));
                break;
            case 173 /* TypeDeclaration */:
                this._transformStack.push(new TypeDeclarationTransform());
                break;
            case 149 /* ReturnType */:
                this._transformStack.push(new ReturnTypeTransform());
                break;
            case 87 /* FunctionDeclarationBody */:
            case 114 /* MethodDeclarationBody */:
                this._transformStack.push(new FunctionDeclarationBodyTransform(node.phraseType));
                break;
            case 28 /* ClassDeclaration */:
                {
                    let t = new ClassDeclarationTransform(this.nameResolver, this.document.nodeHashedLocation(node), this.lastPhpDoc, this.lastPhpDocLocation);
                    this._transformStack.push(t);
                    this.nameResolver.pushClass(t.symbol);
                }
                break;
            case 30 /* ClassDeclarationHeader */:
                this._transformStack.push(new ClassDeclarationHeaderTransform());
                break;
            case 23 /* ClassBaseClause */:
                this._transformStack.push(new ClassBaseClauseTransform());
                break;
            case 31 /* ClassInterfaceClause */:
                this._transformStack.push(new ClassInterfaceClauseTransform());
                break;
            case 142 /* QualifiedNameList */:
                if (parentTransform) {
                    this._transformStack.push(new DelimiteredListTransform(142 /* QualifiedNameList */));
                }
                else {
                    this._transformStack.push(null);
                }
                break;
            case 29 /* ClassDeclarationBody */:
                this._transformStack.push(new TypeDeclarationBodyTransform(29 /* ClassDeclarationBody */));
                break;
            case 103 /* InterfaceDeclaration */:
                {
                    let t = new InterfaceDeclarationTransform(this.nameResolver, this.document.nodeHashedLocation(node), this.lastPhpDoc, this.lastPhpDocLocation);
                    this._transformStack.push(t);
                    this.nameResolver.pushClass(t.symbol);
                }
                break;
            case 105 /* InterfaceDeclarationHeader */:
                this._transformStack.push(new InterfaceDeclarationHeaderTransform());
                break;
            case 102 /* InterfaceBaseClause */:
                this._transformStack.push(new InterfaceBaseClauseTransform());
                break;
            case 104 /* InterfaceDeclarationBody */:
                this._transformStack.push(new TypeDeclarationBodyTransform(104 /* InterfaceDeclarationBody */));
                break;
            case 165 /* TraitDeclaration */:
                this._transformStack.push(new TraitDeclarationTransform(this.nameResolver, this.document.nodeHashedLocation(node), this.lastPhpDoc, this.lastPhpDocLocation));
                break;
            case 167 /* TraitDeclarationHeader */:
                this._transformStack.push(new TraitDeclarationHeaderTransform());
                break;
            case 166 /* TraitDeclarationBody */:
                this._transformStack.push(new TypeDeclarationBodyTransform(166 /* TraitDeclarationBody */));
                break;
            case 25 /* ClassConstDeclaration */:
                this._transformStack.push(new FieldDeclarationTransform(25 /* ClassConstDeclaration */));
                break;
            case 27 /* ClassConstElementList */:
                this._transformStack.push(new DelimiteredListTransform(27 /* ClassConstElementList */));
                break;
            case 26 /* ClassConstElement */:
                this._transformStack.push(new ClassConstantElementTransform(this.nameResolver, this.document.nodeHashedLocation(node), this.lastPhpDoc, this.lastPhpDocLocation));
                break;
            case 137 /* PropertyDeclaration */:
                this._transformStack.push(new FieldDeclarationTransform(137 /* PropertyDeclaration */));
                break;
            case 139 /* PropertyElementList */:
                this._transformStack.push(new DelimiteredListTransform(139 /* PropertyElementList */));
                break;
            case 138 /* PropertyElement */:
                this._transformStack.push(new PropertyElementTransform(this.nameResolver, this.document.nodeHashedLocation(node), this.lastPhpDoc, this.lastPhpDocLocation));
                break;
            case 140 /* PropertyInitialiser */:
                this._transformStack.push(new PropertyInitialiserTransform());
                break;
            case 170 /* TraitUseClause */:
                this._transformStack.push(new TraitUseClauseTransform());
                break;
            case 113 /* MethodDeclaration */:
                this._transformStack.push(new MethodDeclarationTransform(this.nameResolver, this.document.nodeHashedLocation(node), this.lastPhpDoc, this.lastPhpDocLocation));
                break;
            case 115 /* MethodDeclarationHeader */:
                this._transformStack.push(new MethodDeclarationHeaderTransform());
                break;
            case 95 /* Identifier */:
                if (parentNode.phraseType === 115 /* MethodDeclarationHeader */ || parentNode.phraseType === 26 /* ClassConstElement */) {
                    this._transformStack.push(new IdentifierTransform());
                }
                else {
                    this._transformStack.push(null);
                }
                break;
            case 110 /* MemberModifierList */:
                this._transformStack.push(new MemberModifierListTransform());
                break;
            case 2 /* AnonymousClassDeclaration */:
                {
                    let t = new AnonymousClassDeclarationTransform(this.document.nodeHashedLocation(node), this.document.createAnonymousName(node));
                    this._transformStack.push(t);
                    this.nameResolver.pushClass(t.symbol);
                }
                break;
            case 3 /* AnonymousClassDeclarationHeader */:
                this._transformStack.push(new AnonymousClassDeclarationHeaderTransform());
                break;
            case 4 /* AnonymousFunctionCreationExpression */:
                this._transformStack.push(new AnonymousFunctionCreationExpressionTransform(this.document.nodeHashedLocation(node), this.document.createAnonymousName(node)));
                break;
            case 5 /* AnonymousFunctionHeader */:
                this._transformStack.push(new AnonymousFunctionHeaderTransform());
                break;
            case 6 /* AnonymousFunctionUseClause */:
                this._transformStack.push(new AnonymousFunctionUseClauseTransform());
                break;
            case 36 /* ClosureUseList */:
                this._transformStack.push(new DelimiteredListTransform(36 /* ClosureUseList */));
                break;
            case 7 /* AnonymousFunctionUseVariable */:
                this._transformStack.push(new AnonymousFunctionUseVariableTransform(this.document.nodeHashedLocation(node)));
                break;
            case 156 /* SimpleVariable */:
                this._transformStack.push(new SimpleVariableTransform(this.document.nodeHashedLocation(node)));
                break;
            case 85 /* FunctionCallExpression */:
                //define
                if (node.children.length) {
                    let name = this.document.nodeText(node.children[0]).toLowerCase();
                    if (name === 'define' || name === '\\define') {
                        this._transformStack.push(new DefineFunctionCallExpressionTransform(this.document.nodeHashedLocation(node)));
                        break;
                    }
                }
                this._transformStack.push(null);
                break;
            case 8 /* ArgumentExpressionList */:
                if (parentNode.phraseType === 85 /* FunctionCallExpression */ && parentTransform) {
                    this._transformStack.push(new DelimiteredListTransform(8 /* ArgumentExpressionList */));
                }
                else {
                    this._transformStack.push(null);
                }
                break;
            case 84 /* FullyQualifiedName */:
                if (parentTransform) {
                    this._transformStack.push(new FullyQualifiedNameTransform());
                }
                else {
                    this._transformStack.push(null);
                }
                break;
            case 144 /* RelativeQualifiedName */:
                if (parentTransform) {
                    this._transformStack.push(new RelativeQualifiedNameTransform(this.nameResolver));
                }
                else {
                    this._transformStack.push(null);
                }
                break;
            case 141 /* QualifiedName */:
                if (parentTransform) {
                    this._transformStack.push(new QualifiedNameTransform(this.nameResolver));
                }
                else {
                    this._transformStack.push(null);
                }
                break;
            case 121 /* NamespaceName */:
                if (parentTransform) {
                    this._transformStack.push(new NamespaceNameTransform());
                }
                else {
                    this._transformStack.push(null);
                }
                break;
            case undefined:
                //tokens
                if (node.tokenType === 160 /* DocumentComment */) {
                    this.lastPhpDoc = phpDoc_1.PhpDocParser.parse(this.document.nodeText(node));
                    this.lastPhpDocLocation = this.document.nodeHashedLocation(node);
                }
                else if (node.tokenType === 119 /* CloseBrace */) {
                    this.lastPhpDoc = null;
                    this.lastPhpDocLocation = null;
                }
                else if (node.tokenType === 84 /* VariableName */ && parentNode.phraseType === 20 /* CatchClause */) {
                    //catch clause vars
                    for (let n = this._transformStack.length - 1; n > -1; --n) {
                        if (this._transformStack[n]) {
                            this._transformStack[n].push(new CatchClauseVariableNameTransform(this.document.tokenText(node), this.document.nodeHashedLocation(node)));
                            break;
                        }
                    }
                }
                else if (parentTransform && node.tokenType > 1 /* EndOfFile */ && node.tokenType < 85 /* Equals */) {
                    parentTransform.push(new TokenTransform(node, this.document));
                }
                break;
            default:
                if (parentNode.phraseType === 43 /* ConstElement */ ||
                    parentNode.phraseType === 26 /* ClassConstElement */ ||
                    parentNode.phraseType === 129 /* ParameterDeclaration */ ||
                    (parentNode.phraseType === 8 /* ArgumentExpressionList */ && parentTransform)) {
                    this._transformStack.push(new DefaultNodeTransform(node.phraseType, this.document.nodeText(node)));
                }
                else {
                    this._transformStack.push(null);
                }
                break;
        }
        return true;
    }
    postorder(node, spine) {
        if (!node.phraseType) {
            return;
        }
        let transform = this._transformStack.pop();
        if (!transform) {
            return;
        }
        for (let n = this._transformStack.length - 1; n > -1; --n) {
            if (this._transformStack[n]) {
                this._transformStack[n].push(transform);
                break;
            }
        }
        switch (node.phraseType) {
            case 30 /* ClassDeclarationHeader */:
            case 105 /* InterfaceDeclarationHeader */:
            case 3 /* AnonymousClassDeclarationHeader */:
            case 88 /* FunctionDeclarationHeader */:
            case 115 /* MethodDeclarationHeader */:
            case 167 /* TraitDeclarationHeader */:
            case 5 /* AnonymousFunctionHeader */:
                this.lastPhpDoc = null;
                this.lastPhpDocLocation = null;
                break;
            default:
                break;
        }
    }
}
exports.SymbolReader = SymbolReader;
/**
 * Ensures that there are no variable and parameter symbols with same name
 * and excludes inbuilt vars
 */
class UniqueSymbolCollection {
    constructor() {
        this._symbols = [];
        this._varMap = Object.assign({}, UniqueSymbolCollection._inbuilt);
    }
    get length() {
        return this._symbols.length;
    }
    push(s) {
        if (s.kind & (128 /* Parameter */ | 256 /* Variable */)) {
            if (this._varMap[s.name] === undefined) {
                this._varMap[s.name] = true;
                this._symbols.push(s);
            }
        }
        else {
            this._symbols.push(s);
        }
    }
    pushMany(symbols) {
        for (let n = 0, l = symbols.length; n < l; ++n) {
            this.push(symbols[n]);
        }
    }
    toArray() {
        return this._symbols;
    }
}
UniqueSymbolCollection._inbuilt = {
    '$GLOBALS': true,
    '$_SERVER': true,
    '$_GET': true,
    '$_POST': true,
    '$_FILES': true,
    '$_REQUEST': true,
    '$_SESSION': true,
    '$_ENV': true,
    '$_COOKIE': true,
    '$php_errormsg': true,
    '$HTTP_RAW_POST_DATA': true,
    '$http_response_header': true,
    '$argc': true,
    '$argv': true,
    '$this': true
};
class FileTransform {
    constructor(uri, location) {
        this._symbol = symbol_1.PhpSymbol.create(4096 /* File */, uri, location);
        this._children = new UniqueSymbolCollection();
    }
    push(transform) {
        let s = transform.symbol;
        if (s) {
            this._children.push(s);
            return;
        }
        let symbols = transform.symbols;
        if (symbols) {
            this._children.pushMany(symbols);
        }
    }
    get symbol() {
        this._symbol.children = this._children.toArray();
        return this._symbol;
    }
}
class DelimiteredListTransform {
    constructor(phraseType) {
        this.phraseType = phraseType;
        this.transforms = [];
    }
    push(transform) {
        this.transforms.push(transform);
    }
}
class TokenTransform {
    constructor(token, doc) {
        this.token = token;
        this.doc = doc;
    }
    push(transform) { }
    get text() {
        return this.doc.tokenText(this.token);
    }
    get tokenType() {
        return this.token.tokenType;
    }
    get location() {
        return this.doc.nodeHashedLocation(this.token);
    }
}
class NamespaceNameTransform {
    constructor() {
        this.phraseType = 121 /* NamespaceName */;
        this._parts = [];
    }
    push(transform) {
        if (transform.tokenType === 83 /* Name */) {
            this._parts.push(transform.text);
        }
    }
    get text() {
        return this._parts.join('\\');
    }
}
class QualifiedNameTransform {
    constructor(nameResolver) {
        this.nameResolver = nameResolver;
        this.phraseType = 141 /* QualifiedName */;
        this.name = '';
        this.unresolved = '';
    }
    push(transform) {
        if (transform.phraseType === 121 /* NamespaceName */) {
            this.unresolved = transform.text;
            this.name = this.nameResolver.resolveNotFullyQualified(this.unresolved);
        }
    }
}
class RelativeQualifiedNameTransform {
    constructor(nameResolver) {
        this.nameResolver = nameResolver;
        this.phraseType = 144 /* RelativeQualifiedName */;
        this.name = '';
        this.unresolved = '';
    }
    push(transform) {
        if (transform.phraseType === 121 /* NamespaceName */) {
            this.unresolved = transform.text;
            this.name = this.nameResolver.resolveRelative(this.unresolved);
        }
    }
}
class FullyQualifiedNameTransform {
    constructor() {
        this.phraseType = 84 /* FullyQualifiedName */;
        this.name = '';
        this.unresolved = '';
    }
    push(transform) {
        if (transform.phraseType === 121 /* NamespaceName */) {
            this.name = this.unresolved = transform.text;
        }
    }
}
class CatchClauseVariableNameTransform {
    constructor(name, location) {
        this.tokenType = 84 /* VariableName */;
        this.symbol = symbol_1.PhpSymbol.create(256 /* Variable */, name, location);
    }
    push(transform) { }
}
class ParameterDeclarationTransform {
    constructor(location, doc, docLocation, nameResolver) {
        this.phraseType = 129 /* ParameterDeclaration */;
        this.symbol = symbol_1.PhpSymbol.create(128 /* Parameter */, '', location);
        this._doc = doc;
        this._docLocation = docLocation;
        this._nameResolver = nameResolver;
    }
    push(transform) {
        if (transform.phraseType === 173 /* TypeDeclaration */) {
            this.symbol.type = transform.type;
        }
        else if (transform.tokenType === 103 /* Ampersand */) {
            this.symbol.modifiers |= 1024 /* Reference */;
        }
        else if (transform.tokenType === 134 /* Ellipsis */) {
            this.symbol.modifiers |= 2048 /* Variadic */;
        }
        else if (transform.tokenType === 84 /* VariableName */) {
            this.symbol.name = transform.text;
            SymbolReader.assignPhpDocInfoToSymbol(this.symbol, this._doc, this._docLocation, this._nameResolver);
        }
        else {
            this.symbol.value = transform.text;
        }
    }
}
class DefineFunctionCallExpressionTransform {
    constructor(location) {
        this.phraseType = 85 /* FunctionCallExpression */;
        this.symbol = symbol_1.PhpSymbol.create(8 /* Constant */, '', location);
    }
    push(transform) {
        if (transform.phraseType === 8 /* ArgumentExpressionList */) {
            let arg1, arg2;
            [arg1, arg2] = transform.transforms;
            if (arg1 && arg1.tokenType === 78 /* StringLiteral */) {
                this.symbol.name = arg1.text.slice(1, -1); //remove quotes
            }
            //todo --this could be an array or constant too
            if (arg2 && (arg2.tokenType === 79 /* FloatingLiteral */ ||
                arg2.tokenType === 82 /* IntegerLiteral */ ||
                arg2.tokenType === 78 /* StringLiteral */)) {
                this.symbol.value = arg2.text;
            }
            if (this.symbol.name && this.symbol.name[0] === '\\') {
                this.symbol.name = this.symbol.name.slice(1);
            }
        }
    }
}
class SimpleVariableTransform {
    constructor(location) {
        this.phraseType = 156 /* SimpleVariable */;
        this.symbol = symbol_1.PhpSymbol.create(256 /* Variable */, '', location);
    }
    push(transform) {
        if (transform.tokenType === 84 /* VariableName */) {
            this.symbol.name = transform.text;
        }
    }
}
class AnonymousClassDeclarationTransform {
    constructor(location, name) {
        this.phraseType = 2 /* AnonymousClassDeclaration */;
        this.symbol = symbol_1.PhpSymbol.create(1 /* Class */, name, location);
        this.symbol.modifiers = 512 /* Anonymous */;
        this.symbol.children = [];
        this.symbol.associated = [];
    }
    push(transform) {
        if (transform.phraseType === 3 /* AnonymousClassDeclarationHeader */) {
            if (transform.base) {
                this.symbol.associated.push(transform.base);
            }
            Array.prototype.push.apply(this.symbol.associated, transform.interfaces);
        }
        else if (transform.phraseType === 29 /* ClassDeclarationBody */) {
            Array.prototype.push.apply(this.symbol.children, symbol_1.PhpSymbol.setScope(transform.declarations, this.symbol.name));
            Array.prototype.push.apply(this.symbol.associated, transform.useTraits);
        }
    }
}
class TypeDeclarationBodyTransform {
    constructor(phraseType) {
        this.phraseType = phraseType;
        this.declarations = [];
        this.useTraits = [];
    }
    push(transform) {
        switch (transform.phraseType) {
            case 25 /* ClassConstDeclaration */:
            case 137 /* PropertyDeclaration */:
                Array.prototype.push.apply(this.declarations, transform.symbols);
                break;
            case 113 /* MethodDeclaration */:
                this.declarations.push(transform.symbol);
                break;
            case 170 /* TraitUseClause */:
                Array.prototype.push.apply(this.useTraits, transform.symbols);
                break;
            default:
                break;
        }
    }
}
class AnonymousClassDeclarationHeaderTransform {
    constructor() {
        this.phraseType = 3 /* AnonymousClassDeclarationHeader */;
        this.interfaces = [];
    }
    push(transform) {
        if (transform.phraseType === 23 /* ClassBaseClause */) {
            this.base = transform.symbol;
        }
        else if (transform.phraseType === 31 /* ClassInterfaceClause */) {
            this.interfaces = transform.symbols;
        }
    }
}
class AnonymousFunctionCreationExpressionTransform {
    constructor(location, name) {
        this.phraseType = 4 /* AnonymousFunctionCreationExpression */;
        this._symbol = symbol_1.PhpSymbol.create(64 /* Function */, name, location);
        this._symbol.modifiers = 512 /* Anonymous */;
        this._children = new UniqueSymbolCollection();
    }
    push(transform) {
        if (transform.phraseType === 5 /* AnonymousFunctionHeader */) {
            this._symbol.modifiers |= transform.modifier;
            this._children.pushMany(transform.parameters);
            this._children.pushMany(transform.uses);
            this._symbol.type = transform.returnType;
        }
        else if (transform.phraseType === 87 /* FunctionDeclarationBody */) {
            this._children.pushMany(transform.symbols);
        }
    }
    get symbol() {
        this._symbol.children = symbol_1.PhpSymbol.setScope(this._children.toArray(), this._symbol.name);
        return this._symbol;
    }
}
class AnonymousFunctionHeaderTransform {
    constructor() {
        this.phraseType = 5 /* AnonymousFunctionHeader */;
        this.modifier = 0 /* None */;
        this.returnType = '';
        this.parameters = [];
        this.uses = [];
    }
    push(transform) {
        if (transform.tokenType === 103 /* Ampersand */) {
            this.modifier |= 1024 /* Reference */;
        }
        else if (transform.tokenType === 60 /* Static */) {
            this.modifier |= 32 /* Static */;
        }
        else if (transform.phraseType === 130 /* ParameterDeclarationList */) {
            let transforms = transform.transforms;
            for (let n = 0; n < transforms.length; ++n) {
                this.parameters.push(transforms[n].symbol);
            }
        }
        else if (transform.phraseType === 6 /* AnonymousFunctionUseClause */) {
            let symbols = transform.symbols;
            for (let n = 0; n < symbols.length; ++n) {
                this.uses.push(symbols[n]);
            }
        }
        else if (transform.phraseType === 149 /* ReturnType */) {
            this.returnType = transform.type;
        }
    }
}
class FunctionDeclarationBodyTransform {
    constructor(phraseType) {
        this.phraseType = phraseType;
        this._value = new UniqueSymbolCollection();
    }
    push(transform) {
        switch (transform.phraseType) {
            case 156 /* SimpleVariable */:
            case 4 /* AnonymousFunctionCreationExpression */:
            case 2 /* AnonymousClassDeclaration */:
            case 85 /* FunctionCallExpression */://define    
                this._value.push(transform.symbol);
                break;
            case undefined:
                //catch clause vars
                if (transform instanceof CatchClauseVariableNameTransform) {
                    this._value.push(transform.symbol);
                }
                break;
            default:
                break;
        }
    }
    get symbols() {
        return this._value.toArray();
    }
}
class AnonymousFunctionUseClauseTransform {
    constructor() {
        this.phraseType = 6 /* AnonymousFunctionUseClause */;
        this.symbols = [];
    }
    push(transform) {
        if (transform.phraseType === 36 /* ClosureUseList */) {
            let transforms = transform.transforms;
            for (let n = 0; n < transforms.length; ++n) {
                this.symbols.push(transforms[n].symbol);
            }
        }
    }
}
class AnonymousFunctionUseVariableTransform {
    constructor(location) {
        this.phraseType = 7 /* AnonymousFunctionUseVariable */;
        this.symbol = symbol_1.PhpSymbol.create(256 /* Variable */, '', location);
        this.symbol.modifiers = 4096 /* Use */;
    }
    push(transform) {
        if (transform.tokenType === 84 /* VariableName */) {
            this.symbol.name = transform.text;
        }
        else if (transform.tokenType === 103 /* Ampersand */) {
            this.symbol.modifiers |= 1024 /* Reference */;
        }
    }
}
class InterfaceDeclarationTransform {
    constructor(nameResolver, location, doc, docLocation) {
        this.nameResolver = nameResolver;
        this.phraseType = 103 /* InterfaceDeclaration */;
        this.symbol = symbol_1.PhpSymbol.create(2 /* Interface */, '', location);
        SymbolReader.assignPhpDocInfoToSymbol(this.symbol, doc, docLocation, nameResolver);
        this.symbol.children = [];
        this.symbol.associated = [];
    }
    push(transform) {
        if (transform.phraseType === 105 /* InterfaceDeclarationHeader */) {
            this.symbol.name = this.nameResolver.resolveRelative(transform.name);
            this.symbol.associated = transform.extends;
        }
        else if (transform.phraseType === 104 /* InterfaceDeclarationBody */) {
            Array.prototype.push.apply(this.symbol.children, symbol_1.PhpSymbol.setScope(transform.declarations, this.symbol.name));
        }
    }
}
class ConstElementTransform {
    constructor(nameResolver, location, doc, docLocation) {
        this.nameResolver = nameResolver;
        this.phraseType = 43 /* ConstElement */;
        this.symbol = symbol_1.PhpSymbol.create(8 /* Constant */, '', location);
        this.symbol.scope = this.nameResolver.namespaceName;
        this._doc = doc;
        this._docLocation = docLocation;
    }
    push(transform) {
        if (transform.tokenType === 83 /* Name */) {
            this.symbol.name = this.nameResolver.resolveRelative(transform.text);
            SymbolReader.assignPhpDocInfoToSymbol(this.symbol, this._doc, this._docLocation, this.nameResolver);
        }
        else {
            //expression
            this.symbol.value = transform.text;
        }
    }
}
class TraitDeclarationTransform {
    constructor(nameResolver, location, doc, docLocation) {
        this.nameResolver = nameResolver;
        this.phraseType = 165 /* TraitDeclaration */;
        this.symbol = symbol_1.PhpSymbol.create(4 /* Trait */, '', location);
        SymbolReader.assignPhpDocInfoToSymbol(this.symbol, doc, docLocation, nameResolver);
        this.symbol.children = [];
        this.symbol.associated = [];
    }
    push(transform) {
        if (transform.phraseType === 167 /* TraitDeclarationHeader */) {
            this.symbol.name = this.nameResolver.resolveRelative(transform.name);
        }
        else if (transform.phraseType === 166 /* TraitDeclarationBody */) {
            Array.prototype.push.apply(this.symbol.children, symbol_1.PhpSymbol.setScope(transform.declarations, this.symbol.name));
            Array.prototype.push.apply(this.symbol.associated, transform.useTraits);
        }
    }
}
class TraitDeclarationHeaderTransform {
    constructor() {
        this.phraseType = 167 /* TraitDeclarationHeader */;
        this.name = '';
    }
    push(transform) {
        if (transform.tokenType === 83 /* Name */) {
            this.name = transform.text;
        }
    }
}
class InterfaceBaseClauseTransform {
    constructor() {
        this.phraseType = 102 /* InterfaceBaseClause */;
        this.symbols = [];
    }
    push(transform) {
        if (transform.phraseType === 142 /* QualifiedNameList */) {
            let transforms = transform.transforms;
            for (let n = 0; n < transforms.length; ++n) {
                this.symbols.push(symbol_1.PhpSymbol.create(2 /* Interface */, transforms[n].name));
            }
        }
    }
}
class InterfaceDeclarationHeaderTransform {
    constructor() {
        this.phraseType = 105 /* InterfaceDeclarationHeader */;
        this.name = '';
        this.extends = [];
    }
    push(transform) {
        if (transform.tokenType === 83 /* Name */) {
            this.name = transform.text;
        }
        else if (transform.phraseType === 102 /* InterfaceBaseClause */) {
            this.extends = transform.symbols;
        }
    }
}
class TraitUseClauseTransform {
    constructor() {
        this.phraseType = 170 /* TraitUseClause */;
        this.symbols = [];
    }
    push(transform) {
        if (transform.phraseType === 142 /* QualifiedNameList */) {
            let transforms = transform.transforms;
            for (let n = 0; n < transforms.length; ++n) {
                this.symbols.push(symbol_1.PhpSymbol.create(4 /* Trait */, transforms[n].name));
            }
        }
    }
}
class ClassInterfaceClauseTransform {
    constructor() {
        this.phraseType = 31 /* ClassInterfaceClause */;
        this.symbols = [];
    }
    push(transform) {
        if (transform.phraseType === 142 /* QualifiedNameList */) {
            let transforms = transform.transforms;
            for (let n = 0; n < transforms.length; ++n) {
                this.symbols.push(symbol_1.PhpSymbol.create(2 /* Interface */, transforms[n].name));
            }
        }
    }
}
class NamespaceDefinitionTransform {
    constructor(location) {
        this.phraseType = 120 /* NamespaceDefinition */;
        this._symbol = symbol_1.PhpSymbol.create(512 /* Namespace */, '', location);
        this._children = new UniqueSymbolCollection();
    }
    push(transform) {
        if (transform.phraseType === 121 /* NamespaceName */) {
            this._symbol.name = transform.text;
        }
        else {
            let s = transform.symbol;
            if (s) {
                this._children.push(s);
                return;
            }
            let symbols = transform.symbols;
            if (symbols) {
                this._children.pushMany(symbols);
            }
        }
    }
    get symbol() {
        if (this._children.length > 0) {
            this._symbol.children = this._children.toArray();
        }
        return this._symbol;
    }
}
class ClassDeclarationTransform {
    constructor(nameResolver, location, doc, docLocation) {
        this.nameResolver = nameResolver;
        this.phraseType = 28 /* ClassDeclaration */;
        this.symbol = symbol_1.PhpSymbol.create(1 /* Class */, '', location);
        this.symbol.children = [];
        this.symbol.associated = [];
        SymbolReader.assignPhpDocInfoToSymbol(this.symbol, doc, docLocation, nameResolver);
    }
    push(transform) {
        if (transform instanceof ClassDeclarationHeaderTransform) {
            this.symbol.modifiers = transform.modifier;
            this.symbol.name = this.nameResolver.resolveRelative(transform.name);
            if (transform.extends) {
                this.symbol.associated.push(transform.extends);
            }
            Array.prototype.push.apply(this.symbol.associated, transform.implements);
        }
        else if (transform.phraseType === 29 /* ClassDeclarationBody */) {
            Array.prototype.push.apply(this.symbol.children, symbol_1.PhpSymbol.setScope(transform.declarations, this.symbol.name));
            Array.prototype.push.apply(this.symbol.associated, transform.useTraits);
        }
    }
}
class ClassDeclarationHeaderTransform {
    constructor() {
        this.phraseType = 30 /* ClassDeclarationHeader */;
        this.modifier = 0 /* None */;
        this.name = '';
        this.implements = [];
    }
    push(transform) {
        if (transform.tokenType === 2 /* Abstract */) {
            this.modifier = 16 /* Abstract */;
        }
        else if (transform.tokenType === 31 /* Final */) {
            this.modifier = 8 /* Final */;
        }
        else if (transform.tokenType === 83 /* Name */) {
            this.name = transform.text;
        }
        else if (transform.phraseType === 23 /* ClassBaseClause */) {
            this.extends = transform.symbol;
        }
        else if (transform.phraseType === 31 /* ClassInterfaceClause */) {
            this.implements = transform.symbols;
        }
    }
}
class ClassBaseClauseTransform {
    constructor() {
        this.phraseType = 23 /* ClassBaseClause */;
        this.symbol = symbol_1.PhpSymbol.create(1 /* Class */, '');
    }
    push(transform) {
        switch (transform.phraseType) {
            case 84 /* FullyQualifiedName */:
            case 144 /* RelativeQualifiedName */:
            case 141 /* QualifiedName */:
                this.symbol.name = transform.name;
                break;
            default:
                break;
        }
    }
}
class MemberModifierListTransform {
    constructor() {
        this.phraseType = 110 /* MemberModifierList */;
        this.modifiers = 0 /* None */;
    }
    push(transform) {
        switch (transform.tokenType) {
            case 55 /* Public */:
                this.modifiers |= 1 /* Public */;
                break;
            case 56 /* Protected */:
                this.modifiers |= 2 /* Protected */;
                break;
            case 54 /* Private */:
                this.modifiers |= 4 /* Private */;
                break;
            case 2 /* Abstract */:
                this.modifiers |= 16 /* Abstract */;
                break;
            case 31 /* Final */:
                this.modifiers |= 8 /* Final */;
                break;
            case 60 /* Static */:
                this.modifiers |= 32 /* Static */;
                break;
            default:
                break;
        }
    }
}
class ClassConstantElementTransform {
    constructor(nameResolver, location, doc, docLocation) {
        this.nameResolver = nameResolver;
        this.phraseType = 26 /* ClassConstElement */;
        this.symbol = symbol_1.PhpSymbol.create(1024 /* ClassConstant */, '', location);
        this.symbol.modifiers = 32 /* Static */;
        this._doc = doc;
        this._docLocation = docLocation;
    }
    push(transform) {
        if (transform.phraseType === 95 /* Identifier */) {
            this.symbol.name = transform.text;
            SymbolReader.assignPhpDocInfoToSymbol(this.symbol, this._doc, this._docLocation, this.nameResolver);
        }
        else {
            this.symbol.value = transform.text;
        }
    }
}
class MethodDeclarationTransform {
    constructor(nameResolver, location, doc, docLocation) {
        this.nameResolver = nameResolver;
        this.phraseType = 113 /* MethodDeclaration */;
        this._symbol = symbol_1.PhpSymbol.create(32 /* Method */, '', location);
        SymbolReader.assignPhpDocInfoToSymbol(this._symbol, doc, docLocation, nameResolver);
        this._children = new UniqueSymbolCollection();
    }
    push(transform) {
        if (transform instanceof MethodDeclarationHeaderTransform) {
            this._symbol.modifiers = transform.modifiers;
            this._symbol.name = transform.name;
            this._children.pushMany(transform.parameters);
            this._symbol.type = transform.returnType;
        }
        else if (transform.phraseType === 114 /* MethodDeclarationBody */) {
            this._children.pushMany(transform.symbols);
        }
    }
    get symbol() {
        this._symbol.children = symbol_1.PhpSymbol.setScope(this._children.toArray(), this._symbol.name);
        return this._symbol;
    }
}
class ReturnTypeTransform {
    constructor() {
        this.phraseType = 149 /* ReturnType */;
        this.type = '';
    }
    push(transform) {
        if (transform.phraseType === 173 /* TypeDeclaration */) {
            this.type = transform.type;
        }
    }
}
class TypeDeclarationTransform {
    constructor() {
        this.phraseType = 173 /* TypeDeclaration */;
        this.type = '';
    }
    push(transform) {
        switch (transform.phraseType) {
            case 84 /* FullyQualifiedName */:
            case 144 /* RelativeQualifiedName */:
            case 141 /* QualifiedName */:
                if (TypeDeclarationTransform._scalarTypes[transform.unresolved.toLowerCase()] === 1) {
                    this.type = transform.unresolved;
                }
                else {
                    this.type = transform.name;
                }
                break;
            case undefined:
                if (transform.tokenType === 6 /* Callable */ || transform.tokenType === 3 /* Array */) {
                    this.type = transform.text;
                }
                break;
            default:
                break;
        }
    }
}
TypeDeclarationTransform._scalarTypes = { 'int': 1, 'string': 1, 'bool': 1, 'float': 1, 'iterable': 1 };
class IdentifierTransform {
    constructor() {
        this.phraseType = 95 /* Identifier */;
        this.text = '';
    }
    push(transform) {
        this.text = transform.text;
    }
}
class MethodDeclarationHeaderTransform {
    constructor() {
        this.phraseType = 115 /* MethodDeclarationHeader */;
        this.modifiers = 1 /* Public */;
        this.name = '';
        this.returnType = '';
        this.parameters = [];
    }
    push(transform) {
        switch (transform.phraseType) {
            case 110 /* MemberModifierList */:
                this.modifiers = transform.modifiers;
                if (!(this.modifiers & (1 /* Public */ | 2 /* Protected */ | 4 /* Private */))) {
                    this.modifiers |= 1 /* Public */;
                }
                break;
            case 95 /* Identifier */:
                this.name = transform.text;
                break;
            case 130 /* ParameterDeclarationList */:
                {
                    let transforms = transform.transforms;
                    for (let n = 0; n < transforms.length; ++n) {
                        this.parameters.push(transforms[n].symbol);
                    }
                }
                break;
            case 149 /* ReturnType */:
                this.returnType = transform.type;
                break;
            default:
                break;
        }
    }
}
class PropertyInitialiserTransform {
    constructor() {
        this.phraseType = 140 /* PropertyInitialiser */;
        this.text = '';
    }
    push(transform) {
        this.text = transform.text;
    }
}
class PropertyElementTransform {
    constructor(nameResolver, location, doc, docLocation) {
        this.nameResolver = nameResolver;
        this.phraseType = 138 /* PropertyElement */;
        this.symbol = symbol_1.PhpSymbol.create(16 /* Property */, '', location);
        this._doc = doc;
        this._docLocation = docLocation;
    }
    push(transform) {
        if (transform.tokenType === 84 /* VariableName */) {
            this.symbol.name = transform.text;
            SymbolReader.assignPhpDocInfoToSymbol(this.symbol, this._doc, this._docLocation, this.nameResolver);
        }
        else if (transform.phraseType === 140 /* PropertyInitialiser */) {
            this.symbol.value = transform.text;
        }
    }
}
class FieldDeclarationTransform {
    constructor(phraseType) {
        this.phraseType = phraseType;
        this._modifier = 1 /* Public */;
        this.symbols = [];
    }
    push(transform) {
        if (transform.phraseType === 110 /* MemberModifierList */) {
            this._modifier = transform.modifiers;
        }
        else if (transform.phraseType === 139 /* PropertyElementList */ ||
            transform.phraseType === 27 /* ClassConstElementList */) {
            let transforms = transform.transforms;
            let s;
            for (let n = 0; n < transforms.length; ++n) {
                s = transforms[n].symbol;
                if (s) {
                    s.modifiers |= this._modifier;
                    this.symbols.push(s);
                }
            }
        }
    }
}
class FunctionDeclarationTransform {
    constructor(nameResolver, location, phpDoc, phpDocLocation) {
        this.nameResolver = nameResolver;
        this.phraseType = 86 /* FunctionDeclaration */;
        this._symbol = symbol_1.PhpSymbol.create(64 /* Function */, '', location);
        SymbolReader.assignPhpDocInfoToSymbol(this._symbol, phpDoc, phpDocLocation, nameResolver);
        this._children = new UniqueSymbolCollection();
    }
    push(transform) {
        if (transform instanceof FunctionDeclarationHeaderTransform) {
            this._symbol.name = this.nameResolver.resolveRelative(transform.name);
            this._children.pushMany(transform.parameters);
            this._symbol.type = transform.returnType;
        }
        else if (transform.phraseType === 87 /* FunctionDeclarationBody */) {
            this._children.pushMany(transform.symbols);
        }
    }
    get symbol() {
        this._symbol.children = symbol_1.PhpSymbol.setScope(this._children.toArray(), this._symbol.name);
        return this._symbol;
    }
}
class FunctionDeclarationHeaderTransform {
    constructor() {
        this.phraseType = 88 /* FunctionDeclarationHeader */;
        this.name = '';
        this.returnType = '';
        this.parameters = [];
    }
    push(transform) {
        if (transform.tokenType === 83 /* Name */) {
            this.name = transform.text;
        }
        else if (transform.phraseType === 130 /* ParameterDeclarationList */) {
            let transforms = transform.transforms;
            for (let n = 0; n < transforms.length; ++n) {
                this.parameters.push(transforms[n].symbol);
            }
        }
        else if (transform.phraseType === 149 /* ReturnType */) {
            this.returnType = transform.type;
        }
    }
}
class DefaultNodeTransform {
    constructor(phraseType, text) {
        this.phraseType = phraseType;
        this.text = text;
    }
    push(transform) { }
}
(function (SymbolReader) {
    function assignPhpDocInfoToSymbol(s, doc, docLocation, nameResolver) {
        if (!doc) {
            return s;
        }
        let tag;
        switch (s.kind) {
            case 16 /* Property */:
            case 1024 /* ClassConstant */:
                tag = doc.findVarTag(s.name);
                if (tag) {
                    s.doc = symbol_1.PhpSymbolDoc.create(tag.description, typeString_1.TypeString.nameResolve(tag.typeString, nameResolver));
                }
                break;
            case 32 /* Method */:
            case 64 /* Function */:
                tag = doc.returnTag;
                s.doc = symbol_1.PhpSymbolDoc.create(doc.text);
                if (tag) {
                    s.doc.type = typeString_1.TypeString.nameResolve(tag.typeString, nameResolver);
                }
                break;
            case 128 /* Parameter */:
                tag = doc.findParamTag(s.name);
                if (tag) {
                    s.doc = symbol_1.PhpSymbolDoc.create(tag.description, typeString_1.TypeString.nameResolve(tag.typeString, nameResolver));
                }
                break;
            case 1 /* Class */:
            case 4 /* Trait */:
            case 2 /* Interface */:
                s.doc = symbol_1.PhpSymbolDoc.create(doc.text);
                if (!s.children) {
                    s.children = [];
                }
                Array.prototype.push.apply(s.children, phpDocMembers(doc, docLocation, nameResolver));
                break;
            default:
                break;
        }
        return s;
    }
    SymbolReader.assignPhpDocInfoToSymbol = assignPhpDocInfoToSymbol;
    function phpDocMembers(phpDoc, phpDocLoc, nameResolver) {
        let magic = phpDoc.propertyTags;
        let symbols = [];
        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(propertyTagToSymbol(magic[n], phpDocLoc, nameResolver));
        }
        magic = phpDoc.methodTags;
        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(methodTagToSymbol(magic[n], phpDocLoc, nameResolver));
        }
        return symbols;
    }
    SymbolReader.phpDocMembers = phpDocMembers;
    function methodTagToSymbol(tag, phpDocLoc, nameResolver) {
        let s = symbol_1.PhpSymbol.create(32 /* Method */, tag.name, phpDocLoc);
        s.modifiers = 256 /* Magic */ | 1 /* Public */;
        s.doc = symbol_1.PhpSymbolDoc.create(tag.description, typeString_1.TypeString.nameResolve(tag.typeString, nameResolver));
        s.children = [];
        if (tag.isStatic) {
            s.modifiers |= 32 /* Static */;
        }
        if (!tag.parameters) {
            return s;
        }
        for (let n = 0, l = tag.parameters.length; n < l; ++n) {
            s.children.push(magicMethodParameterToSymbol(tag.parameters[n], phpDocLoc, nameResolver));
        }
        return s;
    }
    function magicMethodParameterToSymbol(p, phpDocLoc, nameResolver) {
        let s = symbol_1.PhpSymbol.create(128 /* Parameter */, p.name, phpDocLoc);
        s.modifiers = 256 /* Magic */;
        s.doc = symbol_1.PhpSymbolDoc.create(undefined, typeString_1.TypeString.nameResolve(p.typeString, nameResolver));
        return s;
    }
    function propertyTagToSymbol(t, phpDocLoc, nameResolver) {
        let s = symbol_1.PhpSymbol.create(16 /* Property */, t.name, phpDocLoc);
        s.modifiers = magicPropertyModifier(t) | 256 /* Magic */ | 1 /* Public */;
        s.doc = symbol_1.PhpSymbolDoc.create(t.description, typeString_1.TypeString.nameResolve(t.typeString, nameResolver));
        return s;
    }
    function magicPropertyModifier(t) {
        switch (t.tagName) {
            case '@property-read':
                return 64 /* ReadOnly */;
            case '@property-write':
                return 128 /* WriteOnly */;
            default:
                return 0 /* None */;
        }
    }
    function modifierListToSymbolModifier(phrase) {
        if (!phrase) {
            return 0;
        }
        let flag = 0 /* None */;
        let tokens = phrase.children || [];
        for (let n = 0, l = tokens.length; n < l; ++n) {
            flag |= modifierTokenToSymbolModifier(tokens[n]);
        }
        return flag;
    }
    SymbolReader.modifierListToSymbolModifier = modifierListToSymbolModifier;
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
class NamespaceUseClauseListTransform {
    constructor(phraseType) {
        this.phraseType = phraseType;
        this.symbols = [];
    }
    push(transform) {
        if (transform.phraseType === 122 /* NamespaceUseClause */ ||
            transform.phraseType === 125 /* NamespaceUseGroupClause */) {
            this.symbols.push(transform.symbol);
        }
    }
}
class NamespaceUseDeclarationTransform {
    constructor() {
        this.phraseType = 124 /* NamespaceUseDeclaration */;
        this._kind = 1 /* Class */;
        this._prefix = '';
        this.symbols = [];
    }
    push(transform) {
        if (transform.tokenType === 12 /* Const */) {
            this._kind = 8 /* Constant */;
        }
        else if (transform.tokenType === 35 /* Function */) {
            this._kind = 64 /* Function */;
        }
        else if (transform.phraseType === 121 /* NamespaceName */) {
            this._prefix = transform.text;
        }
        else if (transform.phraseType === 126 /* NamespaceUseGroupClauseList */) {
            this.symbols = transform.symbols;
            let s;
            let prefix = this._prefix ? this._prefix + '\\' : '';
            for (let n = 0; n < this.symbols.length; ++n) {
                s = this.symbols[n];
                s.associated[0].name = prefix + s.associated[0].name;
                if (!s.kind) {
                    s.kind = s.associated[0].kind = this._kind;
                }
            }
        }
        else if (transform.phraseType === 123 /* NamespaceUseClauseList */) {
            this.symbols = transform.symbols;
            let s;
            for (let n = 0; n < this.symbols.length; ++n) {
                s = this.symbols[n];
                s.kind = s.associated[0].kind = this._kind;
            }
        }
    }
}
class NamespaceUseClauseTransform {
    constructor(phraseType, location) {
        this.phraseType = phraseType;
        this.symbol = symbol_1.PhpSymbol.create(0, '', location);
        this.symbol.modifiers = 4096 /* Use */;
        this.symbol.associated = [];
    }
    push(transform) {
        if (transform.tokenType === 35 /* Function */) {
            this.symbol.kind = 64 /* Function */;
        }
        else if (transform.tokenType === 12 /* Const */) {
            this.symbol.kind = 8 /* Constant */;
        }
        else if (transform.phraseType === 121 /* NamespaceName */) {
            let text = transform.text;
            this.symbol.name = symbol_1.PhpSymbol.notFqn(text);
            this.symbol.associated.push(symbol_1.PhpSymbol.create(this.symbol.kind, text));
        }
        else if (transform.phraseType === 119 /* NamespaceAliasingClause */) {
            this.symbol.name = transform.text;
            this.symbol.location = transform.location;
        }
    }
}
class NamespaceAliasingClause {
    constructor() {
        this.phraseType = 119 /* NamespaceAliasingClause */;
        this.text = '';
    }
    push(transform) {
        if (transform.tokenType === 83 /* Name */) {
            this.text = transform.text;
            this.location = transform.location;
        }
    }
}
