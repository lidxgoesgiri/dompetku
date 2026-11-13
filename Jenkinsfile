pipeline {
  agent { label 'dompetku-linux' }
  options {
    skipDefaultCheckout(true)
    disableConcurrentBuilds()
    timeout(time: 30, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
  }
  triggers { githubPush() }
  parameters { string(name: 'DOCKERHUB_USER', defaultValue: '', description: 'Docker Hub namespace for DompetKu') }
  environment {
    DOCKERHUB_USER = "${params.DOCKERHUB_USER}"
    SMOKE_URL = 'http://127.0.0.1:8000/health'
  }
  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script {
          if (!(params.DOCKERHUB_USER ==~ /[a-z0-9][a-z0-9_-]{0,29}/)) { error('Configure a valid Docker Hub namespace') }
        }
        sh 'git rev-parse HEAD'
      }
    }
    stage('Test') {
      steps {
        sh '''#!/bin/sh
          set -eu
          job_id=$(printf '%s' "$JOB_NAME" | cksum | cut -d ' ' -f 1)
          project="dompetku-test-${job_id}-${BUILD_NUMBER}"
          cleanup() { docker compose -p "$project" -f compose.test.yaml down --volumes --remove-orphans; }
          trap cleanup EXIT
          docker compose -p "$project" -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from test
        '''
      }
    }
    stage('Build Image') {
      steps {
        sh '''#!/bin/sh
          set -eu
          image="$DOCKERHUB_USER/dompetku"
          docker build --target runtime -t "$image:$BUILD_NUMBER" -t "$image:latest" .
        '''
      }
    }
    stage('Push Image') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'dockerhub-credentials', usernameVariable: 'DH_USER', passwordVariable: 'DH_PAT')]) {
          sh '''#!/bin/sh
            set +x
            set -eu
            test "$DH_USER" = "$DOCKERHUB_USER"
            export DOCKER_CONFIG="$(mktemp -d)"
            trap 'rm -rf "$DOCKER_CONFIG"' EXIT
            image="$DOCKERHUB_USER/dompetku"
            printf '%s' "$DH_PAT" | docker login -u "$DH_USER" --password-stdin
            docker push "$image:$BUILD_NUMBER"
            docker push "$image:latest"
          '''
        }
      }
    }
    stage('Backup DB') {
      steps {
        withCredentials([file(credentialsId: 'dompetku-deploy-env', variable: 'DEPLOY_ENV')]) {
          sh '''#!/bin/sh
            set +x
            set -eu
            compose() { docker compose -p dompetku --env-file "$DEPLOY_ENV" "$@"; }
            umask 077
            mkdir -p backups
            compose up -d --wait --wait-timeout 120 db
            compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/dompetku-${BUILD_NUMBER}.dump"
            test -s "backups/dompetku-${BUILD_NUMBER}.dump"
            compose exec -T db pg_restore -l < "backups/dompetku-${BUILD_NUMBER}.dump" > /dev/null
          '''
        }
        archiveArtifacts artifacts: 'backups/*.dump', fingerprint: true, allowEmptyArchive: false
      }
    }
    stage('Migrate') {
      steps {
        withCredentials([file(credentialsId: 'dompetku-deploy-env', variable: 'DEPLOY_ENV')]) {
          sh '''#!/bin/sh
            set +x
            set -eu
            compose() { docker compose -p dompetku --env-file "$DEPLOY_ENV" "$@"; }
            image="$DOCKERHUB_USER/dompetku"
            compose pull app
            expected=$(docker image inspect --format '{{.Id}}' "$image:$BUILD_NUMBER")
            actual=$(docker image inspect --format '{{.Id}}' "$image:latest")
            test "$actual" = "$expected"
            compose run --rm --no-deps --pull never app npm run db:migrate
          '''
        }
      }
    }
    stage('Deploy') {
      steps {
        withCredentials([file(credentialsId: 'dompetku-deploy-env', variable: 'DEPLOY_ENV')]) {
          sh '''#!/bin/sh
            set +x
            set -eu
            compose() { docker compose -p dompetku --env-file "$DEPLOY_ENV" "$@"; }
            image="$DOCKERHUB_USER/dompetku"
            expected=$(docker image inspect --format '{{.Id}}' "$image:$BUILD_NUMBER")
            test "$(docker image inspect --format '{{.Id}}' "$image:latest")" = "$expected"
            compose up -d --wait --wait-timeout 120 --pull never
            app_id=$(compose ps -q app)
            test -n "$app_id"
            test "$(docker inspect --format '{{.Image}}' "$app_id")" = "$expected"
            compose ps
          '''
        }
      }
    }
    stage('Smoke Test') {
      steps {
        sh '''#!/bin/sh
          set -eu
          for i in $(seq 1 12); do
            status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$SMOKE_URL") || status=000
            if [ "$status" = 200 ]; then echo 'Smoke Test HTTP 200'; exit 0; fi
            sleep 5
          done
          echo "Smoke Test failed: HTTP $status"
          exit 1
        '''
      }
    }
  }
  post {
    success { echo 'Pipeline succeeded: deployment healthy' }
    failure { echo 'Pipeline failed: inspect the failed stage' }
    aborted { echo 'Pipeline aborted: inspect deployment state' }
    always {
      sh '''#!/bin/sh
        set +e
        rm -f "backups/dompetku-${BUILD_NUMBER}.dump"
        exit 0
      '''
    }
  }
}
