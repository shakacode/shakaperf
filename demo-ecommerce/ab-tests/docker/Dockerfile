ARG RUBY_VERSION=3.4.2
ARG NON_ROOT_USER=my_user
ARG UID=1000
ARG GID=1000
ARG BUNDLE_PATH=/home/${NON_ROOT_USER}/bundle
ARG NODE_PATH=/home/${NON_ROOT_USER}/node
ARG APP_PATH=/home/${NON_ROOT_USER}/app

FROM ruby:${RUBY_VERSION}-bullseye as base

ARG NON_ROOT_USER
ARG UID
ARG GID
ARG BUNDLE_PATH
ARG NODE_PATH
ARG APP_PATH

ARG NODE_VERSION=20.17.0

RUN \
    apt-get update \
    && apt-get install -y \
    apt-transport-https \
    curl \
    libpq-dev \
    build-essential \
    vim \
    nano \
    libvips \
    libmariadb-dev \
    net-tools \
    psmisc

ENV PATH=$NODE_PATH/bin:$PATH
RUN curl -sL https://github.com/nodenv/node-build/archive/master.tar.gz | tar xz -C /tmp/ && \
    /tmp/node-build-master/bin/node-build "${NODE_VERSION}" ${NODE_PATH} && \
    corepack enable && \
    rm -rf /tmp/node-build-master

ENV RAILS_ENV="production" \
    NODE_ENV="production" \
    BUNDLE_DEPLOYMENT="1" \
    BUNDLE_PATH=${BUNDLE_PATH} \
    BUNDLE_WITHOUT="development test"

# Delete any existing group with the same GID (e.g., Mac's GID 20 = dialout on Debian)
RUN getent group $GID | cut -d: -f1 | xargs -r groupdel

# Create non-root user and workspace with matching UID/GID from host
RUN groupadd --gid $GID ${NON_ROOT_USER} && \
    useradd --uid $UID \
    --gid ${NON_ROOT_USER} \
    --shell /bin/sh \
    --create-home ${NON_ROOT_USER}
RUN mkdir -p $APP_PATH && chown -R ${NON_ROOT_USER}:${NON_ROOT_USER} /home/${NON_ROOT_USER}
WORKDIR $APP_PATH

USER ${NON_ROOT_USER}

# Install application gems (production only)
COPY --chown=${NON_ROOT_USER}:${NON_ROOT_USER} Gemfile Gemfile.lock ./
RUN bundle install && \
    rm -rf "/home/${NON_ROOT_USER}/.bundle/" "${BUNDLE_PATH}"/ruby/*/cache "${BUNDLE_PATH}"/ruby/*/bundler/gems/*/.git

COPY --chown=${NON_ROOT_USER}:${NON_ROOT_USER} package.json yarn.lock .yarnrc.yml ./
ARG GH_NPM_TOKEN
ENV GH_NPM_TOKEN=${GH_NPM_TOKEN}
RUN yarn install --immutable

COPY --chown=${NON_ROOT_USER}:${NON_ROOT_USER} . .

ARG GIT_SHA
ARG HONEYBADGER_API_KEY
ARG QZ_PRINT_PKEY
ARG QZ_PRINT_CERT
ARG HOST_URL
ARG SKIP_SOURCE_MAPS_TO_HONEYBADGER
ARG MGXCOPY_RECAPTCHA_SITE_KEY
ARG ENABLE_ANALYTICS_TRACKING
ARG GTM_ID

ENV SKIP_SOURCE_MAPS_TO_HONEYBADGER=$SKIP_SOURCE_MAPS_TO_HONEYBADGER \
    HOST_URL=${HOST_URL} \
    QZ_PRINT_PKEY=${QZ_PRINT_PKEY} \
    QZ_PRINT_CERT=${QZ_PRINT_CERT} \
    GIT_SHA=$GIT_SHA \
    HONEYBADGER_API_KEY=$HONEYBADGER_API_KEY \
    PRINTIVITY_RECAPTCHA_SITE_KEY=${MGXCOPY_RECAPTCHA_SITE_KEY} \
    ENABLE_ANALYTICS_TRACKING=${ENABLE_ANALYTICS_TRACKING} \
    GTM_ID=${GTM_ID} \
    SECRET_KEY_BASE=NOT_USED_NON_BLANK

# Set dummy AWS credentials for asset precompilation
ENV MGXCOPY_AWS_S3_ACCESS_KEY_ID=a123 \
    MGXCOPY_AWS_S3_ANONYMOUS_BUCKET=a123 \
    MGXCOPY_AWS_S3_DEFAULT_BUCKET=a123 \
    MGXCOPY_AWS_S3_PRODUCTION_ITEMS_BUCKET=a123 \
    MGXCOPY_AWS_S3_SECRET_ACCESS_KEY=a123 \
    MGXCOPY_AWS_S3_SOLIDUS_BUCKET=a123

ARG CONFIGURING_DATABASE=1

RUN GIT_SHA=$GIT_SHA \
    HONEYBADGER_API_KEY=$HONEYBADGER_API_KEY \
    PRINTIVITY_RECAPTCHA_SITE_KEY=${MGXCOPY_RECAPTCHA_SITE_KEY} \
    ENABLE_ANALYTICS_TRACKING=${ENABLE_ANALYTICS_TRACKING} \
    GTM_ID=${GTM_ID} \
    MGXCOPY_AWS_S3_ACCESS_KEY_ID=a123 \
    MGXCOPY_AWS_S3_ANONYMOUS_BUCKET=a123 \
    MGXCOPY_AWS_S3_DEFAULT_BUCKET=a123 \
    MGXCOPY_AWS_S3_PRODUCTION_ITEMS_BUCKET=a123 \
    MGXCOPY_AWS_S3_SECRET_ACCESS_KEY=a123 \
    MGXCOPY_AWS_S3_SOLIDUS_BUCKET=a123 \
    bundle exec rails assets:precompile

EXPOSE 3000

