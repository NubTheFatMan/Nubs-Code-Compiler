// This file is kinda copied from http://crockford.com/javascript/tdop/tdop.html :^)
// Not directly copied, but I heavily referenced this and it's demonstration at the bottom ( ͡° ͜ʖ ͡°)

const fs = require('fs'); // For debugging, the parse tree gets outputed to `output.json`

// Takes an input, either a string or an array of strings. Then splits it into an object:
// {
//     type: token_type,
//     value: token_value,
//     lineInd: token_line_number,
//     columnInd: token_column_number
// }
// Here's an example token:
// {
//     type: "name",
//     value: "pain",
//     lineInd: 1,
//     columnInd: 0
// }
function tokenize(source) {
    let lines = (source instanceof Array) ? source : source.trim().split(/\n|\r\n?/); // The lines should be an array, so split it
    let result = [];

    lines.forEach((line, lineInd) => {
        // I really don't get a lot of this token, but it does it's job :^)
        let rx_token = /(\u0020+)|(\/\/.*)|([a-zA-Z][a-zA-Z_0-9]*)|(\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)|("(?:[^"\\]|\\(?:[nr"\\]|u[0-9a-fA-F]{4}))*")|([(){}\[\]?.,:;~*\/]|&&?|\|\|?|[+\-<>^]=?|[!=](?:==)?)/y;

        let columnInd = 0;
        // A function that makes the string a token
        let make = function(type, value) {
            result.push({type, value, lineInd, columnInd});
        }
        while (columnInd < line.length) {
            let captives = rx_token.exec(line);
            if (!captives) throw new SyntaxError("line " + lineInd + ", column " + columnInd);
            else if (captives[3]) make("name", captives[3]);
            else if (captives[4]) {
                let number = Number(captives[4]);
                if (Number.isFinite(number)) make("number", number);
                else throw new TypeError("line " + lineInd + ", column " + columnInd);
            } else if (captives[5]) make("string", JSON.parse(captives[5]));
            else if (captives[6]) make("punctuator", captives[6]);
            columnInd = rx_token.lastIndex;
        }
    });
    return result;
}

function createParserInstance() {
    let scope;
    let symbolTable = {};
    let token;
    let tokens;
    let tokenInd;

    function itself() {return this;}

    let originalScope = {
        define: function(n) {
            let t = this.def[n.value];
            if (typeof t === "object") throw new Error(t.reserved ? 'Already reserved.' : 'Already defined.');
            this.def[n.value] = n;
            n.reserved = false;
            n.nud = itself;
            n.led = null;
            n.std = null;
            n.lbp = 0;
            n.scope = scope;
            return n;
        },
        find: function(n) {
            let e = this, o;
            while (true) {
                o = e.def[n];
                if (o && typeof o !== "function") return o;
                e = e.parent;
                if (!e) {
                    o = symbolTable[n];
                    return (o && typeof o !== "function") ? o : symbolTable["(name)"];
                }
            }
        },
        pop: function() {
            scope = this.parent;
        },
        reserve: function(n) {
            if (n.arity !== "name" || n.reserved) return;
            let t = this.def[n.value];
            if (t) {
                if (t.reserved) return;
                if (t.arity === "name") throw new Error("Already defined.");
            }
            this.def[n.value] = n;
            n.reserved = true;
        }
    };

    let newScope = function() {
        let s = scope;
        scope = Object.create(originalScope);
        scope.def = {};
        scope.parent = s;
        return scope;
    }

    let advance = function(id) {
        let a, o, t, v;
        if (id && token.id !== id) throw new Error("Expected '" + id + "'.");
        if (tokenInd >= tokens.length) {
            token = symbolTable["(end)"];
            return;
        }
        t = tokens[tokenInd++];
        v = t.value;
        a = t.type;
        if (a === "name") {
            o = scope.find(v);
        } else if (a === "punctuator") {
            o = symbolTable[v];
            if (!o) throw new Error("Unknown operator.");
        } else if (a === "string" || a === "number") {
            o = symbolTable["(literal)"];
            a = "literal";
        } else throw new Error("Unexpected token.");
        token = Object.create(o);
        token.lineInd = t.lineInd;
        token.columnInd = t.columnInd;
        token.value = v;
        token.arity = a;
        token.scope = scope;
        return token;
    }

    function expression(rbp) {
        let left;
        let t = token;
        advance();
        left = t.nud();
        while (rbp < token.lbp) {
            t = token;
            advance();
            left = t.led(left);
        }
        return left;
    }

    function statement() {
        let n = token, v;
        if (n.std) {
            advance();
            scope.reserve(n);
            return n.std();
        }
        v = expression(0);
        // if (!v.assignment && v.id !== "(") throw new Error("Bad expression statement '" + v.id + "'.");
        advance(";");
        return v;
    }

    function statements() {
        let a = [], s;
        while (true) {
            if (token.id === "}" || token.id === "(end)") break;
            s = statement();
            if (s) a.push(s);
        }
        return a.length === 0 ? null : a.length === 1 ? a[0] : a;
    }

    function block() {
        let t = token;
        advance("{");
        return t.std();
    }

    let originalSymbol = {
        nud: function() {throw new Error(`Undefined variable access - ${this.value} @ Line ${this.lineInd}, Column ${this.columnInd}`);},
        led: function() {throw new Error("Missing operator.");}
    }

    function symbol(id, bp = 0) {
        let s = symbolTable[id];
        if (s) {
            if (bp >= s.lbp) s.lbp = bp;
        } else {
            s = Object.create(originalSymbol);
            s.id = s.value = id;
            s.lbp = bp;
            symbolTable[id] = s;
        }
        return s;
    }

    function constant(s, v) {
        let x = symbol(s);
        x.nud = function() {
            scope.reserve(this);
            this.value = symbolTable[this.id].value;
            this.arity = "literal";
            return this;
        }
        x.value = v;
        return x;
    }

    function infix(id, bp, led) {
        let s = symbol(id, bp);
        s.led = led || function(left) {
            this.first = left;
            this.second = expression(bp);
            this.arity = "binary";
            return this;
        }
        return s;
    }

    function infixr(id, bp, led) {
        let s = symbol(id, bp);
        s.led = led || function(left) {
            this.first = left;
            this.second = expression(bp - 1);
            this.arity = "binary";
            return this;
        }
        return s;
    }

    function assignment(id) {
        return infixr(id, 10, function(left) {
            if (left.id !== "." && left.id !== "[" && left.arity !== "name") throw new Error("Bad value.");
            this.first = left;
            this.second = expression(9);
            this.assignment = true;
            this.arity = "binary";
            return this;
        });
    }

    function prefix(id, nud) {
        let s = symbol(id);
        s.nud = nud || function() {
            scope.reserve(this);
            this.first = expression(70);
            this.arity = "unary";
            return this;
        }
        return s;
    }

    function stmt(s, f) {
        let x = symbol(s);
        x.std = f;
        return x;
    }

    symbol("(end)");
    symbol("(name)");
    symbol(":");
    symbol(";");
    symbol(")");
    symbol("]");
    symbol("}");
    symbol(",");
    symbol("else");

    constant("true", true);
    constant("false", false);
    constant("null", null);
    constant("pi", Math.PI);
    constant("e", Math.E);
    constant("Object", {});
    constant("Array", []);

    symbol("(literal)").nud = itself;

    symbol("this").nud = function() {
        scope.reserve(this);
        this.arity = "this";
        return this;
    }

    assignment("=");
    assignment("+=");
    assignment("-=");

    infix("?", 20, function(left){
        this.first = left;
        this.second = expression(0);
        advance(":");
        this.third = expression(0);
        this.arity = "ternary";
        return this;
    });

    infixr("&&",  30);
    infixr("||",  30);

    infixr("==", 40);
    infixr("!=", 40);
    infixr("<",   40);
    infixr("<=",  40);
    infixr(">",   40);
    infixr(">=",  40);

    infix("+", 50);
    infix("-", 50);

    infix("*", 60);
    infix("/", 60);

    infix("^", 65);

    infix(".", 80, function(left) {
        this.first = left;
        if (token.arity !== "name") throw new Error("Expected a property name.");
        token.arity = "literal";
        this.second = token;
        this.arity = "binary";
        advance();
        return this;
    });

    infix("[", 80, function(left) {
        this.first = left;
        this.second = expression(0);
        this.arity = "binary";
        advance("]");
        return this;
    });

    infix("(", 80, function(left) {
        let a = [];
        if (left.id === "." || left.id === "[") {
            this.arity = "ternary";
            this.first = left.first;
            this.second = left.second;
            this.third = a;
        } else {
            this.arity = "binary";
            this.first = left;
            this.second = a;
            if ((left.arity !== "unary" || left.id !== "function") && left.arity !== "name" && left.id !== "(" && left.id !== "&&" && left.id !== "||" && left.id !== "?")
                throw new Error("Expected a variable name.");
        }
        if (token.id !== ")") {
            while (true) {
                a.push(expression(0));
                if (token.id !== ",") break;
                advance(",");
            }
        }
        advance(")");
        return this;
    });

    prefix("!");
    prefix("-");
    prefix("typeof");

    prefix("(", function() {
        let e = expression(0);
        advance(")");
        return e;
    });

    prefix("function", function() {
        let a = [];
        newScope();
        if (token.arity === "name") {
            scope.define(token);
            this.name = token.value;
            advance();
        }
        advance("(");
        if (token.id !== ")") {
            while (true) {
                if (token.arity !== "name") throw new Error("Expected a parameter name.");
                scope.define(token);
                a.push(token);
                advance();
                if (token.id !== ",") break;
                advance(",");
            }
        }
        this.first = a;
        advance(")");
        advance("{");
        this.second = statements();
        advance("}");
        this.arity = "function";
        scope.pop();
        return this;
    });

    prefix("[", function() {
        let a = [];
        if (token.id !== "]") {
            while (true) {
                a.push(expression(0));
                if (token.id !== ",") break;
                advance(",")
            }
        }
        advance(']');
        this.first = a;
        this.arity = "unary";
        return this;
    });

    prefix("{", function() {
        let a = [], n, v;
        if (token.id !== "}") {
            while (true) {
                n = token;
                if (n.arity !== "name" && n.arity !== "literal") throw new Error("Bad property name.");
                advance();
                advance(":");
                v = expression(0);
                v.key = n.value;
                a.push(v);
                if (token.id !== ",") break;
                advance(",");
            }
        }
        advance("}");
        this.first = a;
        this.arity = "unary";
        return this;
    });

    stmt("{", function() {
        newScope();
        let a = statements();
        advance("}");
        scope.pop();
        return a;
    });

    stmt("let", function() {
        let a = [], n, t;
        while (true) {
            n = token;
            if (n.arity !== "name") throw new Error("Expected a new variable name.");
            scope.define(n);
            advance();
            if (token.id === "=") {
                t = token;
                advance("=");
                t.first = n;
                t.second = expression(0);
                t.arity = "binary";
                a.push(t);
            }
            if (token.id !== ",") break;
            advance(",");
        }
        advance(";");
        return a.length === 0 ? null : a.length === 1 ? a[0] : a;
    });

    stmt("if", function() {
        advance("(");
        this.first = expression(0);
        advance(")");
        this.second = block();
        if (token.id === "else") {
            scope.reserve(token);
            advance("else");
            this.third = token.id === "if" ? statement() : block();
        } else this.third = null;
        this.arity = "statement";
        return this;
    });

    stmt("return", function() {
        if (token.id !== ";") this.first = expression(0);
        advance(";");
        if (token.id !== "}") throw new Error("Unreachable statement.");
        this.arity = "statement";
        return this;
    });

    stmt("break", function() {
        advance(";");
        if (token.id !== "}") throw new Error("Unreachable statement.");
        this.arity = "statement";
        return this;
    });

    stmt("while", function() {
        advance("(");
        this.first = expression(0);
        advance(")");
        this.second = block();
        this.arity = "statement";
        return this;
    });

    let keys = Object.keys(funcs);
    for (let i = 0; i < keys.length; i++) {
        let key = keys[i];
        let func = funcs[key];
        prefix(key, function() {
            let a = [];
            advance("(");
            if (token.id !== ")") {
                while (true) {
                    a.push(expression(0));
                    if (token.id !== ",") break;
                    advance(",");
                }
            }
            this.first = a;
            this.value = func;
            this.arity = "func";
            advance(")");
            return this;
        });
    }

    return function(tokensArray) {
        tokens = tokensArray;
        tokenInd = 0;
        newScope();
        advance();
        let s = statements();
        advance("(end)");
        scope.pop();
        return s;
    }
}

function parse(tokens) {
    let doParse = createParserInstance();
    let parsed = doParse(tokens);
    return parsed;
}

let funcs = {};
function createFunc(name, funcJS = name) {
    funcs[name] = funcJS;
}
let mathMethods = Object.getOwnPropertyNames(Math).filter(p => Math[p] instanceof Function);
for (let i = 0; i < mathMethods.length; i++) {
    let m = mathMethods[i];
    createFunc(m, `Math.${m}`);
}
createFunc("print", "console.log");

function compileArray(tree) {
    let out = [];
    for (let i = 0; i < tree.length; i++) {
        let t = tree[i];
        out.push(compile(t, true));
    }
    return out;
}

function compileUnary(ar) {
    let out = [];
    if (ar instanceof Array) {
        for (let i = 0; i < ar.length; i++) {
            out.push(compileUnary(ar[i]));
        }
    } else {
        out.push(`"${ar.key.replace(/"/g, '\\"')}":${compile(ar, true)}`);
    }
    return out;
}

function compile(tree, notFirstIteration) {
    let out = '';
    if (tree instanceof Array) {
        for (let i = 0; i < tree.length; i++) {
            let t = tree[i];
            out += compile(t, (i !== 0 ? true : false)) + ";\n";
        }
    } else {
        // if is first iteration
        if (!notFirstIteration) {
            let scope = tree.scope;
            let vars = scope.def;
            for (let v in vars) {
                let vData = vars[v];
                if (vData.reserved) continue;

                let exists = false;
                parentCheck: while (scope.parent) {
                    let scopeVars = scope.def;
                    for (let sv in scopeVars) {
                        if (sv === v) {
                            exists = true;
                            break parentCheck;
                        }
                    }
                    scope = scope.parent;
                }
                if (exists) continue;

                out += `let var_${v};\n`;
            }
        }

        switch (tree.arity) {
            case "name": {
                out += 'var_' + tree.value;
            } break;

            case "literal": {
                if (typeof tree.value === "string") {
                    out += `"${tree.value.replace(/"/g, '\\"')}"`;
                } else {
                    out += String(tree.value);
                }
            } break;
   
            case "func": {
                let params = compileArray(tree.first);
                out += `${tree.value}(${params.join(',')})`;
            } break;

            case "unary": {
                let unary = compileUnary(tree.first);
                out += `{${unary.join(',')}}`;
            } break;
            
            case "statement": {
                if (tree.value !== "return") {
                    let cond = compile(tree.first, true);
                    let wasTrue = compile(tree.second);
                    let wasFalse;
                    if (tree.third) wasFalse = compile(tree.third);
                    out += `${tree.value}(${cond}){\n${wasTrue}\n}${wasFalse ? `else{\n${wasFalse}\n}` : ''}`;
                } else {
                    let right = compile(tree.first, true);
                    out += `${tree.value} ${right}`;
                }
            } break;

            case "binary": {
                let left = compile(tree.first, true);
                let right = (tree.value === "(") ? compileArray(tree.second).join(',') : compile(tree.second, true);

                let sep = tree.value;
                if (tree.value === ".") {
                    right = `[${right}]`;
                    sep = '';
                }
                out += `${left}${sep}${right}`;

                if (tree.value === "[") out += "]";
                
                if (tree.value === "(") out += ")";
            } break;

            case "ternary": {
                let cond = compile(tree.first, true);
                let t = compile(tree.second, true);
                let f = compile(tree.third, true);
                out += `${cond}?${t}:${f}`;
            } break;

            case "function": {
                let params = compileArray(tree.first);
                let block = compile(tree.second, true);
                out += `function(${params.join(',')}){\n${block}\n}`;
            } break;
        }
    }
    return out;
}

function compileAndRun(input) {
    let tokens = tokenize(input);
    let parsed = parse(tokens);
    let compiled = compile(parsed);
    return eval(compiled);
}

let toCompile = `
let myVar = 321;
4 + 5;
print(myVar);
`;

let tokenStart = Date.now();
let tokens = tokenize(toCompile);
let tokenTime = Date.now() - tokenStart;

let parseStart = Date.now();
let out = parse(tokens);
let parseTime = Date.now() - parseStart;

let compStart = Date.now();
let compiled = compile(out);
let compTime = Date.now() - compStart;

let totalTime = Date.now() - tokenStart;

fs.writeFileSync("parse_tree.json", JSON.stringify(out, ["key", "name", "value", "arity", "first", "second", "third"], 4));

console.log('\n// Input:');
console.log(toCompile.trim());
console.log('\n// Output (reconstructed/compiled):');
console.log(compiled);
console.log(`//----------------\n// Lexer time: ${tokenTime}ms\n// Parser time: ${parseTime}ms\n// Compiler time: ${compTime}ms\n// Total time: ${totalTime}ms`);