// @ts-check
import { BackgroundHandler } from '@netlify/functions'
import { Octokit } from '@octokit/rest'
import fs from 'fs'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import { kebabCase } from 'lodash-es'
import { tmpdir } from 'os'
import path from 'path'
import { inspect } from 'util'
import { literal, number, object, string, union, z } from 'zod'
import { ThemeData } from '../../../src/data/themes/index.js'
import { Image, Link } from '../../../src/types.js'

const now = Date.now()

const repoUrl = 'https://github.com/withastro/astro.build.git'
const repoFolder = path.join(tmpdir(), `astro.build-${now}`)

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
})

const formImageSchema = object({
    filename: string(),
    type: string(),
    size: number(),
    url: string()
})

const themeDataSchema = object({
    mainPreviewImage: formImageSchema,
    previewImage1: union([formImageSchema, literal('')]).optional(),
    previewImage2: union([formImageSchema, literal('')]).optional(),
    previewImage3: union([formImageSchema, literal('')]).optional(),
    previewImage4: union([formImageSchema, literal('')]).optional(),
    authorName: string(),
    authorEmail: string(),
    themeName: string(),
    paidStatus: string(),
    repoUrl: string().optional(),
    purchaseUrl: string().optional(),
    liveDemoUrl: string().optional(),
    shortDescription: string()
})

export const handler: BackgroundHandler = async (event) => {
    if (!event.body) {
        throw new Error('No body')
    }

    try {
        const body = event.isBase64Encoded
            ? JSON.parse(Buffer.from(event.body, 'base64').toString())
            : JSON.parse(event.body)

        const themeData = themeDataSchema.parse(body?.data)

        console.log(
            'Theme data:',
            inspect(themeData, { depth: Infinity, colors: true })
        )

        const branchName = `theme-submissions/${kebabCase(
            themeData.themeName
        )}-${now}`
        console.log('Branch name:', branchName)

        const themeFileName = `${kebabCase(themeData.themeName)}-${now}.json`
        console.log('Theme file name:', themeFileName)

        console.log('mkdir', path.dirname(repoFolder))
        await fs.promises.mkdir(path.dirname(repoFolder), { recursive: true })

        console.log('git.clone', repoUrl, repoFolder)
        await git.clone({
            fs,
            http,
            url: repoUrl,
            dir: repoFolder,
            singleBranch: true,
            depth: 1
        })

        console.log('git.branch', branchName)
        await git.branch({
            fs,
            dir: repoFolder,
            ref: branchName
        })

        console.log('git.checkout', branchName)
        await git.checkout({
            fs,
            dir: repoFolder,
            ref: branchName
        })

        console.log(
            'write',
            path.join(repoFolder, 'src/data/themes', themeFileName)
        )

        const localThemeData: ThemeData = getLocalThemeData(themeData)

        await fs.promises.writeFile(
            path.join(repoFolder, 'src/data/themes', themeFileName),
            JSON.stringify(localThemeData, undefined, 2)
        )

        console.log('git.add .')
        await git.add({
            fs,
            dir: repoFolder,
            filepath: path.join(repoFolder, 'src/data/themes', themeFileName)
        })

        console.log('git.commit')
        await git.commit({
            fs,
            dir: repoFolder,
            author: {
                name: 'astrobot',
                email: 'astrobot@astro.build'
            },
            message: `Add theme ${themeData.themeName}`
        })

        console.log('git.push')
        await git.push({
            fs,
            http,
            dir: repoFolder,
            remote: 'origin',
            ref: branchName,
            onAuth: () => ({
                username: 'astrobot',
                password: process.env.GITHUB_TOKEN
            })
        })

        console.log('create PR')
        await octokit.pulls.create({
            owner: 'withastro',
            repo: 'astro.build',
            title: `THEME: ${themeData.themeName ?? ''}`,
            body: [
                `**Author**: ${themeData.authorName ?? 'N/A'}`,
                `**Paid or Free**: ${themeData.paidStatus ?? 'N/A'}`,
                `**Repo Link**: ${themeData.repoUrl ?? 'N/A'}`,
                `**Purchase Link**: ${themeData.purchaseUrl ?? 'N/A'}`,
                `**Live Demo Link**: ${themeData.liveDemoUrl ?? 'N/A'}`,
                `**Preview Image**: ${
                    themeData.mainPreviewImage?.url ?? 'N/A'
                }`,
                ``,
                themeData.shortDescription ?? ''
            ].join('\n'),
            head: branchName,
            base: 'main'
        })

        console.log('done!')
    } finally {
        await fs.promises.rm(repoFolder, { recursive: true, force: true })
    }
}

function getLocalThemeData(
    themeData: z.infer<typeof themeDataSchema>
): ThemeData {
    const themeImages: Image[] = []
    if (themeData.previewImage1) {
        themeImages.push({
            src: themeData.previewImage1.url,
            alt: ''
        })
    }
    if (themeData.previewImage2) {
        themeImages.push({
            src: themeData.previewImage2.url,
            alt: ''
        })
    }
    if (themeData.previewImage3) {
        themeImages.push({
            src: themeData.previewImage3.url,
            alt: ''
        })
    }
    if (themeData.previewImage4) {
        themeImages.push({
            src: themeData.previewImage4.url,
            alt: ''
        })
    }

    const links: Link[] = []
    if (themeData.purchaseUrl) {
        links.push({
            href: themeData.purchaseUrl,
            text: 'Purchase'
        })
    }

    const localThemeData: ThemeData = {
        title: themeData.themeName,
        description: themeData.shortDescription,
        fullDescription: '',
        image: {
            src: themeData.mainPreviewImage.url,
            alt: `Preview for ${themeData.themeName}`
        },
        images: themeImages,
        categories: [],
        slug: ''
    }

    if (themeData.repoUrl) {
        localThemeData.repoUrl = {
            href: themeData.repoUrl,
            text: 'View Repo'
        }
    }

    if (themeData.liveDemoUrl) {
        localThemeData.demoUrl = {
            href: themeData.liveDemoUrl,
            text: 'View Demo'
        }
    }

    return localThemeData
}
