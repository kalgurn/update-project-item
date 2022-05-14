import * as core from '@actions/core'
import * as github from '@actions/github'

// TODO: Ensure this (and the Octokit client) works for non-github.com URLs, as well.
// https://github.com/orgs|users/<ownerName>/projects/<projectNumber>
const urlParse =
  /^(?:https:\/\/)?github\.com\/(?<ownerType>orgs|users)\/(?<ownerName>[^/]+)\/projects\/(?<projectNumber>\d+)/

interface ProjectNodeIDResponse {
  organization?: {
    projectNext: {
      id: string
    }
  }

  user?: {
    projectNext: {
      id: string
    }
  }
}

interface ProjectFieldNodes {
  id: string
  name: string
  settings: string
}
interface ProjectFieldNodeIDResponse {
  node: {
    fields: {
      nodes: ProjectFieldNodes[]
    }
  }
}

interface ProjectUpdateItemFieldResponse {
  updateProjectNextItemField: {
    projectNextItem: {
      id: string
    }
  }
}
interface StatusOption {
  id: string
  name: string
  name_html: string
}
interface StatusOptions {
  options: StatusOption[]
}

export async function updateProjectItemStatus(): Promise<void> {
  const projectUrl = core.getInput('project-url', {required: true})
  const ghToken = core.getInput('github-token', {required: true})
  const itemId = core.getInput('item-id', {required: true})
  const status = core.getInput('status', {required: true})

  const octokit = github.getOctokit(ghToken)
  const urlMatch = projectUrl.match(urlParse)

  if (!ghToken) {
    throw new Error('Parameter token or opts.auth is required')
  }

  if (!itemId) {
    throw new Error('Item ID is required')
  }

  if (!status) {
    throw new Error('Status is required')
  }

  core.debug(`Project URL: ${projectUrl}`)

  if (!urlMatch) {
    throw new Error(
      `Invalid project URL: ${projectUrl}. Project URL should match the format https://github.com/<orgs-or-users>/<ownerName>/projects/<projectNumber>`
    )
  }

  const ownerName = urlMatch.groups?.ownerName
  const projectNumber = parseInt(urlMatch.groups?.projectNumber ?? '', 10)
  const ownerType = urlMatch.groups?.ownerType
  const ownerTypeQuery = mustGetOwnerTypeQuery(ownerType)

  core.debug(`Org name: ${ownerName}`)
  core.debug(`Project number: ${projectNumber}`)
  core.debug(`Owner type: ${ownerType}`)
  core.debug(`Item ID: ${itemId}`)
  core.debug(`Status: ${status}`)

  const idResp = await octokit.graphql<ProjectNodeIDResponse>(
    `query getProject($ownerName: String!, $projectNumber: Int!) { 
          ${ownerTypeQuery}(login: $ownerName) {
            projectNext(number: $projectNumber) {
              id
            }
          }
        }`,
    {
      ownerName,
      projectNumber
    }
  )

  const projectId = idResp[ownerTypeQuery]?.projectNext.id
  core.debug(`Project ID: ${projectId}`)

  const fieldResp = await octokit.graphql<ProjectFieldNodeIDResponse>(
    `query ($projectId: ID!) {
          node(id: $projectId) {
            ... on ProjectNext {
              fields(first:20) {
                nodes {
                  id
                  name
                  settings
                }
              }
            }
          }
        }`,
    {
      projectId
    }
  )

  const statusField = getStatusFieldData(fieldResp.node.fields.nodes)
  const statusColumnId = getStatusColumnIdFromSettings(
    statusField.settings,
    status
  )
  const statusFieldId = statusField.id

  core.debug(`Status field ID: ${statusFieldId}`)
  core.debug(`Status column ID: ${statusColumnId}`)

  const updateResp = await octokit.graphql<ProjectUpdateItemFieldResponse>(
    `mutation ($projectId: ID!, $itemId: ID!, $statusFieldId: ID!, $statusColumnId: String!) {
        updateProjectNextItemField(
          input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $statusFieldId
            value: $statusColumnId
          }
        ) {
          projectNextItem {
            id
          }
        }
      }`,
    {
      projectId,
      itemId,
      statusFieldId,
      statusColumnId
    }
  )

  core.debug(`Update response: ${JSON.stringify(updateResp)}`)
}

export function mustGetOwnerTypeQuery(
  ownerType?: string
): 'organization' | 'user' {
  const ownerTypeQuery =
    ownerType === 'orgs'
      ? 'organization'
      : ownerType === 'users'
      ? 'user'
      : null

  if (!ownerTypeQuery) {
    throw new Error(
      `Unsupported ownerType: ${ownerType}. Must be one of 'orgs' or 'users'`
    )
  }

  return ownerTypeQuery
}

export function getStatusFieldData(
  fieldNodes: ProjectFieldNodes[]
): ProjectFieldNodes {
  const statusField = fieldNodes.find(field => field.name === 'Status')
  if (!statusField) {
    throw new Error(`Status field not found.`)
  }
  return statusField
}

export function getStatusColumnIdFromSettings(
  settings: string,
  status: string
): string {
  const settingsJson: StatusOptions = JSON.parse(settings)
  const options = settingsJson.options
  if (!options) {
    throw new Error(`No options found.`)
  }
  const statusColumnId = options.find(option => option.name === status)?.id

  if (!statusColumnId) {
    throw new Error(`Status column ID not found in settings: ${settings}`)
  }
  return statusColumnId
}
