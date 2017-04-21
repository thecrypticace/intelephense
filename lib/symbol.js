/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("./types");
const phpDoc_1 = require("./phpDoc");
const parsedDocument_1 = require("./parsedDocument");
const util = require("./util");
const builtInSymbols = require("./builtInSymbols.json");
var PhpSymbol;
(function (PhpSymbol) {
    function isParameter(s) {
        return s.kind === 128 /* Parameter */;
    }
    function signatureString(s) {
        if (!s || !(s.kind & (64 /* Function */ | 32 /* Method */))) {
            return '';
        }
        let params = s.children ? s.children.filter(isParameter) : [];
        let paramStrings = [];
        let param;
        let parts;
        for (let n = 0, l = params.length; n < l; ++n) {
            param = params[n];
            parts = [];
            if (n) {
                parts.push(',');
            }
            if (param.type && !param.type.isEmpty()) {
                parts.push(param.type.toString());
            }
            parts.push(param.name);
            if (param.value) {
                paramStrings.push(`[${parts.join(' ')}]`);
            }
            else {
                paramStrings.push(parts.join(' '));
            }
        }
        let sig = `(${paramStrings.join('')})`;
        if (s.type && !s.type.isEmpty()) {
            sig += `: ${s.type}`;
        }
        return sig;
    }
    PhpSymbol.signatureString = signatureString;
    function hasParameters(s) {
        return s.children && s.children.find(isParameter) !== undefined;
    }
    PhpSymbol.hasParameters = hasParameters;
    function notFqn(text) {
        if (!text) {
            return text;
        }
        let pos = text.lastIndexOf('\\') + 1;
        return text.slice(pos);
    }
    PhpSymbol.notFqn = notFqn;
})(PhpSymbol = exports.PhpSymbol || (exports.PhpSymbol = {}));
class NameResolver {
    constructor(document, importedSymbols, namespaceName, thisName, thisBaseName) {
        this.document = document;
        this.importedSymbols = importedSymbols;
        this.namespaceName = namespaceName;
        this.thisName = thisName;
        this.thisBaseName = thisBaseName;
    }
    resolveRelative(relativeName) {
        if (!relativeName) {
            return '';
        }
        return this.namespaceName ? this.namespaceName + '\\' + relativeName : relativeName;
    }
    resolveNotFullyQualified(notFqName, kind) {
        if (!notFqName) {
            return '';
        }
        if (notFqName === 'self' || notFqName === 'static') {
            return this.thisName;
        }
        if (notFqName === 'parent') {
            return this.thisBaseName;
        }
        let pos = notFqName.indexOf('\\');
        return pos < 0 ?
            this._resolveUnqualified(notFqName, kind) :
            this._resolveQualified(notFqName, pos);
    }
    createAnonymousName(node) {
        return this.document.createAnonymousName(node);
    }
    namespaceNamePhraseText(node, endOffset) {
        if (!node || !node.parts || node.parts.length < 1) {
            return '';
        }
        let parts = [];
        let t;
        for (let n = 0, l = node.parts.length; n < l; ++n) {
            t = node.parts[n];
            if (endOffset && parsedDocument_1.ParsedDocument.isOffsetInToken(endOffset, t)) {
                parts.push(this.document.tokenText(t).substr(0, endOffset + 1 - t.offset));
                break;
            }
            parts.push(this.document.tokenText(node.parts[n]));
        }
        return parts.join('\\');
    }
    namePhraseToFqn(node, kind) {
        if (!parsedDocument_1.ParsedDocument.isPhrase(node, [
            83 /* FullyQualifiedName */, 143 /* RelativeQualifiedName */, 140 /* QualifiedName */
        ])) {
            return '';
        }
        let name = this.namespaceNamePhraseText(node.name);
        switch (node.phraseType) {
            case 140 /* QualifiedName */:
                return this.resolveNotFullyQualified(name, kind);
            case 143 /* RelativeQualifiedName */:
                return this.resolveRelative(name);
            case 83 /* FullyQualifiedName */:
                return name;
            default:
                return '';
        }
    }
    tokenText(t, endOffset) {
        let text = this.document.tokenText(t).slice();
        if (endOffset) {
            text = text.substr(0, endOffset + 1 - t.offset);
        }
        return text;
    }
    _matchImportedSymbol(text, kind) {
        let s;
        for (let n = 0, l = this.importedSymbols.length; n < l; ++n) {
            s = this.importedSymbols[n];
            if (s.kind === kind && text === s.name) {
                return s;
            }
        }
        return null;
    }
    _resolveQualified(name, pos) {
        let s = this._matchImportedSymbol(name.slice(0, pos), 1 /* Class */);
        return s ? s.associated[0].name + name.slice(pos) : this.resolveRelative(name);
    }
    _resolveUnqualified(name, kind) {
        let s = this._matchImportedSymbol(name, kind);
        return s ? s.associated[0].name : this.resolveRelative(name);
    }
}
exports.NameResolver = NameResolver;
class TypeString {
    constructor(text) {
        this._parts = text ? this._chunk(text) : [];
    }
    isEmpty() {
        return this._parts.length < 1;
    }
    atomicClassArray() {
        let parts = [];
        let part;
        for (let n = 0; n < this._parts.length; ++n) {
            part = this._parts[n];
            if (part[part.length - 1] !== ']' && TypeString._keywords.indexOf(part) < 0) {
                parts.push(part);
            }
        }
        return parts;
    }
    arrayDereference() {
        let parts = [];
        let part;
        for (let n = 0; n < this._parts.length; ++n) {
            part = this._parts[n];
            if (part.slice(-2) === '[]') {
                part = part.slice(0, -2);
                if (part.slice(-1) === ')') {
                    part = part.slice(1, -1);
                    Array.prototype.push.apply(parts, this._chunk(part));
                    parts = this._unique(parts);
                }
                else {
                    parts.push(part);
                }
            }
        }
        let typeString = new TypeString(null);
        typeString._parts = parts;
        return typeString;
    }
    array() {
        let text;
        if (this._parts.length > 1) {
            text = '(' + this.toString() + ')[]';
        }
        else {
            text = this._parts[0] + '[]';
        }
        return new TypeString(text);
    }
    merge(type) {
        if (!type) {
            return this;
        }
        let parts = util.isString(type) ? this._chunk(type) : type._parts;
        Array.prototype.push.apply(parts, this._parts);
        let newTypeString = new TypeString(null);
        newTypeString._parts = this._unique(parts);
        return newTypeString;
    }
    nameResolve(nameResolver) {
        let replacer = (match, offset, text) => {
            if (match === 'self' || match === '$this' || match === 'static') {
                return nameResolver.thisName;
            }
            else if (TypeString._keywords.indexOf(match) >= 0) {
                return match;
            }
            else if (match[0] === '\\') {
                return match.slice(1);
            }
            else {
                return nameResolver.resolveNotFullyQualified(match, 1 /* Class */);
            }
        };
        return new TypeString(this._parts.join('|').replace(TypeString._classNamePattern, replacer));
    }
    toString() {
        return this._parts.join('|');
    }
    _unique(parts) {
        let map = {};
        let part;
        for (let n = 0; n < parts.length; ++n) {
            part = parts[n];
            map[part] = part;
        }
        return Object.keys(map);
    }
    _chunk(typeString) {
        let n = 0;
        let parentheses = 0;
        let parts = [];
        let part = '';
        let c;
        while (n < typeString.length) {
            c = typeString[n];
            switch (c) {
                case '|':
                    if (parentheses) {
                        part += c;
                    }
                    else if (part) {
                        parts.push(part);
                        part = '';
                    }
                    break;
                case '(':
                    ++parentheses;
                    part += c;
                    break;
                case ')':
                    --parentheses;
                    part += c;
                    break;
                default:
                    part += c;
                    break;
            }
            ++n;
        }
        if (part) {
            parts.push(part);
        }
        return parts;
    }
}
TypeString._classNamePattern = /[$\\a-zA-Z_\x7f-\xff][\\a-zA-Z0-9_\x7f-\xff]*/g;
TypeString._keywords = [
    'string', 'integer', 'int', 'boolean', 'bool', 'float',
    'double', 'object', 'mixed', 'array', 'resource',
    'void', 'null', 'false', 'true', 'self', 'static',
    'callable', '$this'
];
exports.TypeString = TypeString;
class SymbolTable {
    constructor(uri, root) {
        this.uri = uri;
        this.root = root;
    }
    get symbols() {
        let traverser = new types_1.TreeTraverser([this.root]);
        let symbols = traverser.toArray();
        //remove root
        symbols.shift();
        return symbols;
    }
    get count() {
        let traverser = new types_1.TreeTraverser([this.root]);
        //subtract 1 for root
        return traverser.count() - 1;
    }
    filter(predicate) {
        let traverser = new types_1.TreeTraverser([this.root]);
        return traverser.filter(predicate);
    }
    find(predicate) {
        let traverser = new types_1.TreeTraverser([this.root]);
        return traverser.find(predicate);
    }
    symbolAtPosition(position) {
        let pred = (x) => {
            return x.location &&
                x.location.range.start.line === position.line &&
                x.location.range.start.character === position.character;
        };
        return this.filter(pred).pop();
    }
    static create(parsedDocument, ignorePhraseTypes) {
        let symbolReader = new SymbolReader(parsedDocument, new NameResolver(parsedDocument, [], '', '', ''), [{ kind: 0 /* None */, name: '', children: [] }]);
        symbolReader.ignore = ignorePhraseTypes;
        parsedDocument.traverse(symbolReader);
        return new SymbolTable(parsedDocument.uri, symbolReader.spine[0]);
    }
    static createBuiltIn() {
        builtInSymbolTypeStrings(builtInSymbols);
        return new SymbolTable('\\', {
            kind: 0 /* None */,
            name: '',
            children: builtInSymbols
        });
    }
}
exports.SymbolTable = SymbolTable;
class SymbolStore {
    constructor() {
        this.onParsedDocumentChange = (args) => {
            this.remove(args.parsedDocument.uri);
            this.add(SymbolTable.create(args.parsedDocument));
        };
        this._map = {};
        this._index = new SymbolIndex();
        this._symbolCount = 0;
    }
    getSymbolTable(uri) {
        return this._map[uri];
    }
    get tableCount() {
        return Object.keys(this._map).length;
    }
    get symbolCount() {
        return this._symbolCount;
    }
    add(symbolTable) {
        if (this.getSymbolTable(symbolTable.uri)) {
            throw new Error(`Duplicate key ${symbolTable.uri}`);
        }
        this._map[symbolTable.uri] = symbolTable;
        this._index.addMany(this._indexSymbols(symbolTable.root));
        this._symbolCount += symbolTable.count;
    }
    remove(uri) {
        let symbolTable = this.getSymbolTable(uri);
        if (!symbolTable) {
            return;
        }
        this._index.removeMany(this._indexSymbols(symbolTable.root));
        this._symbolCount -= symbolTable.count;
        delete this._map[uri];
    }
    /**
     * As per match but returns first item in result that matches text exactly
     * @param text
     * @param kindMask
     */
    find(text, filter) {
        let exactMatchFn = (x) => {
            return (!filter || filter(x)) && x.name === text;
        };
        return this.match(text, exactMatchFn).shift();
    }
    /**
     * Matches any indexed symbol by name or partial name with optional additional filter
     * Parameters and variables that are not file scoped are not indexed.
     */
    match(text, filter, fuzzy) {
        if (!text) {
            return [];
        }
        let matched = this._index.match(text, fuzzy);
        if (!filter) {
            return matched;
        }
        let filtered = [];
        let s;
        for (let n = 0, l = matched.length; n < l; ++n) {
            s = matched[n];
            if (filter(s)) {
                filtered.push(s);
            }
        }
        return filtered;
    }
    _classOrInterfaceFilter(s) {
        return (s.kind & (1 /* Class */ | 2 /* Interface */)) > 0;
    }
    lookupTypeMembers(query) {
        let type = this.find(query.typeName, this._classOrInterfaceFilter);
        return this._lookupTypeMembers(type, query.memberPredicate, []);
    }
    lookupTypeMember(query) {
        return this.lookupTypeMembers(query).shift();
    }
    lookupMembersOnTypes(queries) {
        let symbols = [];
        for (let n = 0, l = queries.length; n < l; ++n) {
            Array.prototype.push.apply(symbols, this.lookupTypeMembers(queries[n]));
        }
        return symbols;
    }
    lookupMemberOnTypes(queries) {
        return this.lookupMembersOnTypes(queries).shift();
    }
    _lookupTypeMembers(type, predicate, typeHistory) {
        if (!type || typeHistory.indexOf(type.name) > -1) {
            return [];
        }
        //prevent cyclical lookup
        typeHistory.push(type.name);
        let members = type.children ? type.children.filter(predicate) : [];
        let associated = [];
        let associatedKindMask = 1 /* Class */ ? 1 /* Class */ | 4 /* Trait */ : 2 /* Interface */;
        let baseSymbol;
        if (type.associated) {
            for (let n = 0, l = type.associated.length; n < l; ++n) {
                baseSymbol = type.associated[n];
                if ((baseSymbol.kind & associatedKindMask) > 0 && baseSymbol.name) {
                    associated.push(baseSymbol);
                }
            }
        }
        //lookup in base class/traits
        let basePredicate = (x) => {
            return predicate(x) && !(x.modifiers & 4 /* Private */);
        };
        for (let n = 0, l = associated.length; n < l; ++n) {
            baseSymbol = associated[n];
            baseSymbol = this.find(baseSymbol.name, (x) => {
                return x.kind === baseSymbol.kind;
            });
            if (baseSymbol) {
                Array.prototype.push.apply(members, this._lookupTypeMembers(baseSymbol, basePredicate, typeHistory));
            }
        }
        return members;
    }
    _indexSymbols(root) {
        let traverser = new types_1.TreeTraverser([root]);
        return traverser.filter(this._indexFilter);
    }
    _indexFilter(s) {
        return s.kind !== 128 /* Parameter */ &&
            (s.kind !== 256 /* Variable */ || !s.scope) &&
            !(s.modifiers & 4096 /* Use */) &&
            s.name.length > 0;
    }
}
exports.SymbolStore = SymbolStore;
class SymbolReader {
    constructor(parsedDocument, nameResolver, spine) {
        this.parsedDocument = parsedDocument;
        this.nameResolver = nameResolver;
        this.spine = spine;
    }
    preOrder(node, spine) {
        if (this.ignore && parsedDocument_1.ParsedDocument.isPhrase(node, this.ignore)) {
            return false;
        }
        let s;
        switch (node.phraseType) {
            case 119 /* NamespaceDefinition */:
                s = this.namespaceDefinition(node);
                this.nameResolver.namespaceName = s.name;
                this._addSymbol(s, false);
                return true;
            case 123 /* NamespaceUseDeclaration */:
                [this.namespaceUseDeclarationKind, this.namespaceUseDeclarationPrefix] =
                    this.namespaceUseDeclaration(node);
                return true;
            case 121 /* NamespaceUseClause */:
                s = this.namespaceUseClause(node, this.namespaceUseDeclarationKind, this.namespaceUseDeclarationPrefix);
                if (!s) {
                    return false;
                }
                this._addSymbol(s, false);
                if (s.associated && s.associated.length > 0 && s.name) {
                    this.nameResolver.importedSymbols.push(s);
                }
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
                    s.type = new TypeString(typeDeclarationValue); //type hints trump phpdoc
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
                if (s && SymbolReader._globalVars.indexOf(s.name) < 0 && !this._variableExists(s.name)) {
                    this._addSymbol(s, false);
                }
                return false;
            case 20 /* CatchClause */:
                s = {
                    kind: 256 /* Variable */,
                    name: this.parsedDocument.tokenText(node.variable),
                    location: this.tokenLocation(node.variable)
                };
                if (!this._variableExists(s.name)) {
                    this._addSymbol(s, false);
                }
                return true;
            case undefined:
                this._token(node);
                return false;
            default:
                return true;
        }
    }
    postOrder(node, spine) {
        if (this.ignore && parsedDocument_1.ParsedDocument.isPhrase(node, this.ignore)) {
            return;
        }
        switch (node.phraseType) {
            case 119 /* NamespaceDefinition */:
                if (node.statementList) {
                    this.nameResolver.namespaceName = '';
                }
                break;
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
    _shouldReadVar(spine) {
        for (let n = spine.length - 1; n >= 0; --n) {
            if (SymbolReader._varAncestors.indexOf(spine[n].phraseType) > -1) {
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
                let phpDocTokenText = this.parsedDocument.tokenText(t);
                this.lastPhpDoc = phpDoc_1.PhpDocParser.parse(phpDocTokenText);
                this.lastPhpDocLocation = {
                    uri: this.parsedDocument.uri,
                    range: {
                        start: this.parsedDocument.positionAtOffset(t.offset),
                        end: this.parsedDocument.positionAtOffset(t.offset + phpDocTokenText.length)
                    }
                };
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
    nameTokenToFqn(t) {
        let name = this.parsedDocument.tokenText(t);
        return name ? this.nameResolver.resolveRelative(name) : '';
    }
    phraseLocation(p) {
        if (!p) {
            return null;
        }
        let range = this.parsedDocument.phraseRange(p);
        if (!range) {
            return null;
        }
        return {
            uri: this.parsedDocument.uri,
            range: range
        };
    }
    tokenLocation(t) {
        if (!t) {
            return null;
        }
        let range = this.parsedDocument.tokenRange(t);
        if (!range) {
            return null;
        }
        return {
            uri: this.parsedDocument.uri,
            range: range
        };
    }
    functionDeclaration(node, phpDoc) {
        let s = {
            kind: 64 /* Function */,
            name: '',
            location: this.phraseLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new TypeString(returnTag.typeString).nameResolve(this.nameResolver);
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
            name: this.parsedDocument.tokenText(node.name),
            location: this.phraseLocation(node)
        };
        if (phpDoc) {
            let tag = phpDoc.findParamTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(this.nameResolver);
            }
        }
        if (node.value) {
            s.value = this.parsedDocument.nodeText(node.value);
        }
        return s;
    }
    typeDeclaration(node) {
        if (!node.name) {
            return '';
        }
        if (node.name.phraseType) {
            let text = this.qualifiedName(node.name, 1 /* Class */);
            let notFqn = text.split('\\').pop();
            if (SymbolReader._builtInTypes.indexOf(notFqn) > -1) {
                return notFqn;
            }
            return text;
        }
        else {
            return this.parsedDocument.tokenText(node.name);
        }
    }
    qualifiedName(node, kind) {
        if (!node || !node.name) {
            return '';
        }
        let name = this.parsedDocument.nodeText(node.name, [161 /* Whitespace */]);
        switch (node.phraseType) {
            case 140 /* QualifiedName */:
                return this.nameResolver.resolveNotFullyQualified(name, kind);
            case 143 /* RelativeQualifiedName */:
                return this.nameResolver.resolveRelative(name);
            case 83 /* FullyQualifiedName */:
            default:
                return name;
        }
    }
    constElement(node, phpDoc) {
        let s = {
            kind: 8 /* Constant */,
            name: this.nameTokenToFqn(node.name),
            location: this.phraseLocation(node)
        };
        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(this.nameResolver);
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
            name: this.parsedDocument.nodeText(node.name),
            location: this.phraseLocation(node)
        };
        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(this.nameResolver);
            }
        }
        return s;
    }
    methodDeclaration(node, phpDoc) {
        let s = {
            kind: 32 /* Method */,
            name: '',
            location: this.phraseLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new TypeString(returnTag.typeString).nameResolve(this.nameResolver);
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
            name: this.parsedDocument.tokenText(node.name),
            modifiers: modifiers,
            location: this.phraseLocation(node)
        };
        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(this.nameResolver);
            }
        }
        return s;
    }
    identifier(node) {
        return this.parsedDocument.tokenText(node.name);
    }
    interfaceDeclaration(node, phpDoc, phpDocLoc) {
        let s = {
            kind: 2 /* Interface */,
            name: '',
            location: this.phraseLocation(node),
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
            type: new TypeString(tag.typeString).nameResolve(this.nameResolver),
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
            type: new TypeString(p.typeString).nameResolve(this.nameResolver),
            location: phpDocLoc
        };
    }
    propertyTagToSymbol(t, phpDocLoc) {
        return {
            kind: 16 /* Property */,
            name: t.name,
            modifiers: this.magicPropertyModifier(t) | 256 /* Magic */,
            type: new TypeString(t.typeString).nameResolve(this.nameResolver),
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
            location: this.phraseLocation(node),
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
            location: this.phraseLocation(node),
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
            name: this.qualifiedName(node.name, 1 /* Class */)
        };
    }
    classInterfaceClause(node) {
        let mapFn = (name) => {
            return {
                kind: 2 /* Interface */,
                name: name
            };
        };
        return this.qualifiedNameList(node.nameList).map(mapFn);
    }
    traitUseClause(node) {
        let mapFn = (name) => {
            return {
                kind: 4 /* Trait */,
                name: name
            };
        };
        return this.qualifiedNameList(node.nameList).map(mapFn);
    }
    anonymousClassDeclaration(node) {
        return {
            kind: 1 /* Class */,
            name: this.parsedDocument.createAnonymousName(node),
            modifiers: 512 /* Anonymous */,
            location: this.phraseLocation(node)
        };
    }
    anonymousFunctionCreationExpression(node) {
        return {
            kind: 64 /* Function */,
            name: this.parsedDocument.createAnonymousName(node),
            modifiers: 512 /* Anonymous */,
            location: this.phraseLocation(node)
        };
    }
    anonymousFunctionUseVariable(node) {
        return {
            kind: 256 /* Variable */,
            name: this.parsedDocument.tokenText(node.name),
            location: this.phraseLocation(node),
            modifiers: 4096 /* Use */
        };
    }
    simpleVariable(node) {
        if (!parsedDocument_1.ParsedDocument.isToken(node.name, [84 /* VariableName */])) {
            return null;
        }
        return {
            kind: 256 /* Variable */,
            name: this.parsedDocument.tokenText(node.name),
            location: this.phraseLocation(node)
        };
    }
    qualifiedNameList(node) {
        let names = [];
        let name;
        if (!node) {
            return names;
        }
        for (let n = 0, l = node.elements.length; n < l; ++n) {
            name = this.qualifiedName(node.elements[n], 1 /* Class */);
            if (name) {
                names.push(name);
            }
        }
        return names;
    }
    concatNamespaceName(prefix, name) {
        if (!name) {
            return name;
        }
        else if (!prefix) {
            return name;
        }
        else {
            return prefix + '\\' + name;
        }
    }
    namespaceUseClause(node, kind, prefix) {
        let fqn = this.concatNamespaceName(prefix, this.parsedDocument.nodeText(node.name, [161 /* Whitespace */]));
        if (!fqn) {
            return null;
        }
        let s = {
            kind: kind ? kind : 1 /* Class */,
            name: node.aliasingClause ? this.parsedDocument.tokenText(node.aliasingClause.alias) : PhpSymbol.notFqn(fqn),
            associated: [],
            location: this.phraseLocation(node),
            modifiers: 4096 /* Use */
        };
        s.associated.push({ kind: s.kind, name: fqn });
        return s;
    }
    tokenToSymbolKind(t) {
        switch (t.tokenType) {
            case 35 /* Function */:
                return 64 /* Function */;
            case 12 /* Const */:
                return 8 /* Constant */;
            default:
                return 0 /* None */;
        }
    }
    namespaceUseDeclaration(node) {
        return [
            node.kind ? this.tokenToSymbolKind(node.kind) : 0 /* None */,
            node.prefix ? this.parsedDocument.nodeText(node.prefix, [161 /* Whitespace */]) : ''
        ];
    }
    namespaceDefinition(node) {
        return {
            kind: 512 /* Namespace */,
            name: this.parsedDocument.nodeText(node.name, [161 /* Whitespace */]),
            location: this.phraseLocation(node),
            children: []
        };
    }
}
SymbolReader._varAncestors = [
    107 /* ListIntrinsic */, 76 /* ForeachKey */, 78 /* ForeachValue */,
    16 /* ByRefAssignmentExpression */, 38 /* CompoundAssignmentExpression */,
    154 /* SimpleAssignmentExpression */
];
SymbolReader._builtInTypes = [
    'array', 'callable', 'int', 'string', 'bool', 'float'
];
SymbolReader._globalVars = [
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
exports.SymbolReader = SymbolReader;
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
class SymbolIndex {
    constructor() {
        this._nodeArray = [];
        this._binarySearch = new types_1.BinarySearch(this._nodeArray);
        this._collator = new Intl.Collator('en');
    }
    add(item) {
        let suffixes = this._symbolKeys(item);
        let node;
        for (let n = 0; n < suffixes.length; ++n) {
            node = this._nodeFind(suffixes[n]);
            if (node) {
                node.items.push(item);
            }
            else {
                this._insertNode({ key: suffixes[n], items: [item] });
            }
        }
    }
    addMany(items) {
        for (let n = 0; n < items.length; ++n) {
            this.add(items[n]);
        }
    }
    remove(item) {
        let suffixes = this._symbolKeys(item);
        let node;
        let i;
        for (let n = 0; n < suffixes.length; ++n) {
            node = this._nodeFind(suffixes[n]);
            if (!node) {
                continue;
            }
            i = node.items.indexOf(item);
            if (i !== -1) {
                node.items.splice(i, 1);
                if (!node.items.length) {
                    //uneccessary? save a lookup and splice
                    //this._deleteNode(node);
                }
            }
        }
    }
    removeMany(items) {
        for (let n = 0; n < items.length; ++n) {
            this.remove(items[n]);
        }
    }
    match(text, fuzzy) {
        text = text.toLowerCase();
        let substrings;
        if (fuzzy) {
            let trigrams = util.trigrams(text);
            trigrams.add(text);
            substrings = Array.from(trigrams);
        }
        else {
            substrings = [text];
        }
        let nodes = [];
        for (let n = 0, l = substrings.length; n < l; ++n) {
            Array.prototype.push.apply(nodes, this._nodeMatch(text));
        }
        let matches = [];
        for (let n = 0; n < nodes.length; ++n) {
            Array.prototype.push.apply(matches, nodes[n].items);
        }
        if (fuzzy) {
            return this._sortedFuzzyResults(text, matches);
        }
        else {
            return Array.from(new Set(matches));
        }
    }
    _sortedFuzzyResults(query, matches) {
        let map = {};
        let s;
        let name;
        let checkIndexOf = query.length > 3;
        let val;
        for (let n = 0, l = matches.length; n < l; ++n) {
            s = matches[n];
            name = s.name;
            if (map[name] === undefined) {
                val = 0;
                if (checkIndexOf) {
                    val = (PhpSymbol.notFqn(s.name).indexOf(query) + 1) * -10;
                    if (val < 0) {
                        val += 1000;
                    }
                }
                map[name] = val;
            }
            ++map[name];
        }
        let unique = Array.from(new Set(matches));
        let sortFn = (a, b) => {
            return map[b.name] - map[a.name];
        };
        unique.sort(sortFn);
        return unique;
    }
    _nodeMatch(lcText) {
        let collator = this._collator;
        let compareLowerFn = (n) => {
            return collator.compare(n.key, lcText);
        };
        let compareUpperFn = (n) => {
            return n.key.slice(0, lcText.length) === lcText ? -1 : 1;
        };
        return this._binarySearch.range(compareLowerFn, compareUpperFn);
    }
    _nodeFind(text) {
        let lcText = text.toLowerCase();
        let collator = this._collator;
        let compareFn = (n) => {
            return collator.compare(n.key, lcText);
        };
        return this._binarySearch.find(compareFn);
    }
    _insertNode(node) {
        let collator = this._collator;
        let rank = this._binarySearch.rank((n) => {
            return collator.compare(n.key, node.key);
        });
        this._nodeArray.splice(rank, 0, node);
    }
    _deleteNode(node) {
        let collator = this._collator;
        let rank = this._binarySearch.rank((n) => {
            return collator.compare(n.key, node.key);
        });
        if (this._nodeArray[rank] === node) {
            this._nodeArray.splice(rank, 1);
        }
    }
    _symbolKeys(s) {
        let notFqnPos = s.name.lastIndexOf('\\') + 1;
        let notFqn = s.name.slice(notFqnPos);
        let lcNotFqn = notFqn.toLowerCase();
        let lcFqn = s.name.toLowerCase();
        let keys = util.trigrams(lcNotFqn);
        if (lcNotFqn) {
            keys.add(lcNotFqn);
        }
        keys.add(lcFqn);
        let acronym = util.acronym(notFqn);
        if (acronym.length > 1) {
            keys.add(acronym);
        }
        return Array.from(keys);
    }
}
exports.SymbolIndex = SymbolIndex;
class ExpressionTypeResolver {
    constructor(nameResolver, symbolStore, variableTable) {
        this.nameResolver = nameResolver;
        this.symbolStore = symbolStore;
        this.variableTable = variableTable;
    }
    resolveExpression(node) {
        if (!node) {
            return new TypeString('');
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
                return new TypeString(this.nameResolver.createAnonymousName(node));
            case 140 /* QualifiedName */:
            case 83 /* FullyQualifiedName */:
            case 143 /* RelativeQualifiedName */:
                return new TypeString(this.nameResolver.namePhraseToFqn(node, 1 /* Class */));
            case 144 /* RelativeScope */:
                return new TypeString(this.nameResolver.thisName);
            default:
                return new TypeString('');
        }
    }
    ternaryExpression(node) {
        return new TypeString('')
            .merge(this.resolveExpression(node.trueExpr))
            .merge(this.resolveExpression(node.falseExpr));
    }
    scopedMemberAccessExpression(node, kind) {
        let memberName = this.scopedMemberName(node.memberName);
        let scopeTypeString = this.resolveExpression(node.scope);
        if (!scopeTypeString || scopeTypeString.isEmpty() || !memberName) {
            return new TypeString('');
        }
        let typeNames = scopeTypeString.atomicClassArray();
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
            if (typeName === this.nameResolver.thisName) {
                visibilityNotModifierMask = 0;
            }
            else if (typeName === this.nameResolver.thisBaseName) {
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
            return this.nameResolver.tokenText(node.name);
        }
        else if (node && parsedDocument_1.ParsedDocument.isPhrase(node.name, [94 /* Identifier */])) {
            return this.nameResolver.tokenText(node.name.name);
        }
        return '';
    }
    classTypeDesignator(node) {
        if (node && parsedDocument_1.ParsedDocument.isPhrase(node.type, [140 /* QualifiedName */, 83 /* FullyQualifiedName */, 143 /* RelativeQualifiedName */])) {
            return new TypeString(this.nameResolver.namePhraseToFqn(node.type, 1 /* Class */));
        }
        else if (node && parsedDocument_1.ParsedDocument.isPhrase(node.type, [144 /* RelativeScope */])) {
            return new TypeString(this.nameResolver.thisName);
        }
        else {
            return new TypeString('');
        }
    }
    objectCreationExpression(node) {
        if (parsedDocument_1.ParsedDocument.isPhrase(node.type, [2 /* AnonymousClassDeclaration */])) {
            return new TypeString(this.nameResolver.createAnonymousName(node));
        }
        else if (parsedDocument_1.ParsedDocument.isPhrase(node.type, [34 /* ClassTypeDesignator */])) {
            return this.classTypeDesignator(node.type);
        }
        else {
            return new TypeString('');
        }
    }
    simpleVariable(node) {
        if (parsedDocument_1.ParsedDocument.isToken(node.name, [84 /* VariableName */])) {
            return this.variableTable.getType(this.nameResolver.tokenText(node.name), this.nameResolver.thisName);
        }
        return new TypeString('');
    }
    subscriptExpression(node) {
        let type = this.resolveExpression(node.dereferencable);
        return type ? type.arrayDereference() : new TypeString('');
    }
    functionCallExpression(node) {
        let qName = node.callableExpr;
        if (!parsedDocument_1.ParsedDocument.isPhrase(qName, [83 /* FullyQualifiedName */, 140 /* QualifiedName */, 143 /* RelativeQualifiedName */])) {
            return new TypeString('');
        }
        let functionName = this.nameResolver.namePhraseToFqn(qName, 64 /* Function */);
        let symbol = this.symbolStore.find(functionName, (x) => { return x.kind === 64 /* Function */; });
        return symbol && symbol.type ? symbol.type : new TypeString('');
    }
    memberName(node) {
        return node ? this.nameResolver.tokenText(node.name) : '';
    }
    instanceMemberAccessExpression(node, kind) {
        let memberName = parsedDocument_1.ParsedDocument.isToken(node.memberName) ?
            this.nameResolver.tokenText(node.memberName) :
            this.memberName(node.memberName);
        let type = this.resolveExpression(node.variable);
        if (!memberName || !type) {
            return new TypeString('');
        }
        if (kind === 16 /* Property */) {
            memberName = '$' + memberName;
        }
        let symbols = this.lookupMemberOnTypes(type.atomicClassArray(), kind, memberName, 0, 32 /* Static */);
        return this.mergeTypes(symbols);
    }
    mergeTypes(symbols) {
        let type = new TypeString('');
        let symbol;
        for (let n = 0, l = symbols.length; n < l; ++n) {
            type = type.merge(symbols[n].type);
        }
        return type;
    }
}
exports.ExpressionTypeResolver = ExpressionTypeResolver;
class VariableTypeResolver {
    constructor(variableTable, document, nameResolver, symbolStore, haltAtToken) {
        this.variableTable = variableTable;
        this.document = document;
        this.nameResolver = nameResolver;
        this.symbolStore = symbolStore;
        this.haltAtToken = haltAtToken;
        this.haltTraverse = false;
    }
    preOrder(node, spine) {
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
                    this._checkForHaltToken(node);
                    return false;
                }
                return true;
            case 99 /* InstanceOfExpression */:
                this._instanceOfExpression(node);
                this._checkForHaltToken(node);
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
    postOrder(node, spine) {
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
    _checkForHaltToken(ancestor) {
        if (!this.haltAtToken) {
            return;
        }
        let tFirst = this.document.firstToken(ancestor);
        let tEnd = this.document.lastToken(ancestor);
        if (this.haltAtToken.offset >= tFirst.offset && this.haltAtToken.offset <= tEnd.offset) {
            this.haltTraverse = true;
        }
    }
    _qualifiedNameList(node) {
        let fqns = [];
        for (let n = 0, l = node.elements.length; n < l; ++n) {
            fqns.push(this.nameResolver.namePhraseToFqn(node.elements[n], 1 /* Class */));
        }
        return new TypeString(fqns.join('|'));
    }
    _catchClause(node) {
        this.variableTable.setType(this.nameResolver.tokenText(node.variable), this._qualifiedNameList(node.nameList));
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
        if (this.haltAtToken === t) {
            this.haltTraverse = true;
            return;
        }
        //doc block type hints
        if (t.tokenType === 160 /* DocumentComment */) {
            let phpDoc = phpDoc_1.PhpDocParser.parse(this.document.tokenText(t));
            if (phpDoc) {
                let varTags = phpDoc.varTags;
                let varTag;
                for (let n = 0, l = varTags.length; n < l; ++n) {
                    varTag = varTags[n];
                    this.variableTable.setType(varTag.name, new TypeString(varTag.typeString).nameResolve(this.nameResolver));
                }
            }
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
        let range = this.document.phraseRange(p);
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
        return this._isNonDynamicSimpleVariable(node) ? this.nameResolver.tokenText(node.name) : '';
    }
    _instanceOfExpression(node) {
        let lhs = node.left;
        let rhs = node.right;
        let varName = this._simpleVariable(lhs);
        let exprTypeResolver = new ExpressionTypeResolver(this.nameResolver, this.symbolStore, this.variableTable);
        this.variableTable.setType(varName, exprTypeResolver.resolveExpression(rhs));
    }
    _isNonDynamicSimpleVariable(node) {
        return parsedDocument_1.ParsedDocument.isPhrase(node, [155 /* SimpleVariable */]) &&
            parsedDocument_1.ParsedDocument.isToken(node.name, [84 /* VariableName */]);
    }
    _assignmentExpression(node) {
        let lhs = node.left;
        let rhs = node.right;
        let exprTypeResolver = new ExpressionTypeResolver(this.nameResolver, this.symbolStore, this.variableTable);
        let type;
        if (parsedDocument_1.ParsedDocument.isPhrase(lhs, [155 /* SimpleVariable */])) {
            let varName = this._simpleVariable(lhs);
            type = exprTypeResolver.resolveExpression(rhs);
            this.variableTable.setType(varName, type);
        }
        else if (parsedDocument_1.ParsedDocument.isPhrase(node, [107 /* ListIntrinsic */])) {
            let varNames = this._listIntrinsic(rhs);
            this.variableTable.setTypeMany(varNames, exprTypeResolver.resolveExpression(rhs).arrayDereference());
        }
    }
    _foreachStatement(node) {
        let collection = node.collection;
        let value = node.value;
        let exprResolver = new ExpressionTypeResolver(this.nameResolver, this.symbolStore, this.variableTable);
        let type = exprResolver.resolveExpression(collection.expr).arrayDereference();
        if (parsedDocument_1.ParsedDocument.isPhrase(value.expr, [155 /* SimpleVariable */])) {
            let varName = this._simpleVariable(value.expr);
            this.variableTable.setType(varName, type);
        }
        else if (parsedDocument_1.ParsedDocument.isPhrase(value.expr, [107 /* ListIntrinsic */])) {
            let varNames = this._listIntrinsic(value.expr);
            this.variableTable.setTypeMany(varNames, type.arrayDereference());
        }
    }
}
exports.VariableTypeResolver = VariableTypeResolver;
class VariableTable {
    constructor() {
        this._typeVariableSetStack = [{
                kind: 1 /* Scope */,
                variables: {},
                branches: []
            }];
    }
    setType(varName, type) {
        if (!varName || !type || type.isEmpty()) {
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
                type = this.getType(carry[n], '');
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
    getType(varName, thisName) {
        if (varName === '$this') {
            return new TypeString(thisName);
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
        return new TypeString('');
    }
    _mergeSets(a, b) {
        let keys = Object.keys(b.variables);
        let typedVar;
        for (let n = 0, l = keys.length; n < l; ++n) {
            typedVar = b.variables[keys[n]];
            if (a.variables[typedVar.name]) {
                a.variables[typedVar.name].type = a.variables[typedVar.name].type.merge(typedVar.type);
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
function builtInSymbolTypeStrings(symbols) {
    let s;
    for (let n = 0, l = symbols.length; n < l; ++n) {
        s = symbols[n];
        if (s.type) {
            s.type = new TypeString(s.type);
        }
        if (s.children) {
            builtInSymbolTypeStrings(s.children);
        }
    }
}
