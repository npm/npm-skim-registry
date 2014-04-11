var
    MultiFS = require('multi-fs'),
    path    = require('path')
    ;

if (!process.env.MANTA_KEY_ID || !process.env.MANTA_USER || !process.env.MANTA_URL)
{
    console.error('not ok - need manta environs');
    process.exit(1);
}

if (!process.env.SSH_AUTH_SOCK)
{
    console.error('not ok - only ssh-agent authentication is supported');
    process.exit(1);
}

var base = path.resolve(__dirname, 'tmp/registry-testing');

var cwd = process.cwd()
var locshort = base
if (cwd && base.indexOf(cwd) === 0)
    locshort = base.substr(cwd.length).replace(/^\/+/, '');

var home = process.env.HOME;
var homeshort = base;
if (home && base.indexOf(home) === 0)
    homeshort = base.substr(home.length).replace(/^\/+/, '');

var targets =
[
    { type: 'fs', path: base + '/0' },
    // 'ssh://localhost:' + homeshort + '/1',
    '~~/stor/registry-testing/2',
];

module.exports = new MultiFS(targets);
