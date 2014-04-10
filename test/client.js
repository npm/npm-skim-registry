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

var base = path.resolve(__dirname, 'fixtures/destinations');

var cwd = process.cwd()
var locshort = base
if (cwd && base.indexOf(cwd) === 0)
    locshort = base.substr(cwd.length).replace(/^\/+/, '')

var home = process.env.HOME;
var homeshort = base;
if (home && base.indexOf(home) === 0)
    homeshort = base.substr(home.length).replace(/^\/+/, '');

var targets = [
    { type: 'fs', path: base + '/0' },
    { type: 'fs', path: locshort + '/1' },
    base + '/2',
    locshort + '/3',
    '~/' + homeshort + '/4',
/*
    'ssh://localhost:' + homeshort + '/5',
    'ssh://localhost' + base + '/6',
    {
        type: 'ssh',
        agent: process.env.SSH_AUTH_SOCK,
        path: homeshort + '/7'
    },
    {
        type: 'ssh',
        agent: process.env.SSH_AUTH_SOCK,
        path: base + '/8'
    },
*/
    '~~/stor/registry-testing/9',
    'manta:/' + process.env.MANTA_USER + '/stor/registry-testing/10',

    {
        path: '~~/stor/registry-testing/11',
        type: 'manta',
        env: {},
        argv: [
            '-a', process.env.MANTA_USER,
            '-k', process.env.MANTA_KEY_ID,
            '-u', process.env.MANTA_URL
        ]
    },
    {
        path: '~~/stor/registry-testing/12',
        type: 'manta',
        argv: [],
        env: {
            MANTA_USER: process.env.MANTA_USER,
            MANTA_KEY_ID: process.env.MANTA_KEY_ID,
            MANTA_URL: process.env.MANTA_URL
        }
    }
];

module.exports = new MultiFS(targets);
