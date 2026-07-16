import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
} from 'amazon-cognito-identity-js'
import type { AppConfig } from './config'

let pool: CognitoUserPool | null = null

export function initAuth(cfg: AppConfig) {
  pool = new CognitoUserPool({ UserPoolId: cfg.userPoolId, ClientId: cfg.userPoolClientId })
}

function requirePool(): CognitoUserPool {
  if (!pool) throw new Error('auth not initialized')
  return pool
}

export function signUp(email: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    requirePool().signUp(
      email,
      password,
      [new CognitoUserAttribute({ Name: 'email', Value: email })],
      [],
      (err) => (err ? reject(err) : resolve()),
    )
  })
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: requirePool() })
  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err) => (err ? reject(err) : resolve()))
  })
}

export function signIn(email: string, password: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: requirePool() })
  const details = new AuthenticationDetails({ Username: email, Password: password })
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: () => resolve(),
      onFailure: reject,
    })
  })
}

export function signOut(): void {
  requirePool().getCurrentUser()?.signOut()
}

export function currentUserEmail(): string | null {
  return requirePool().getCurrentUser()?.getUsername() ?? null
}

/** 세션이 있으면 idToken(JWT) 반환, 없으면 null. 만료 시 자동 갱신됨. */
export function getIdToken(): Promise<string | null> {
  const user = requirePool().getCurrentUser()
  if (!user) return Promise.resolve(null)
  return new Promise((resolve) => {
    user.getSession(
      (err: Error | null, session: { isValid(): boolean; getIdToken(): { getJwtToken(): string } } | null) => {
        if (err || !session || !session.isValid()) resolve(null)
        else resolve(session.getIdToken().getJwtToken())
      },
    )
  })
}
