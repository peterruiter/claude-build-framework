# ===========================================================================
# One image: the API and both web apps.
#
#   1. web      node builds both Vite apps into the API's wwwroot
#   2. publish  the .NET SDK runs the tests (unless RUN_TESTS=false) and publishes
#   3. runtime  aspnet with nothing but the published output, as a non-root user
#
# Built in the registry by build/Publish-Container.ps1 (az acr build), so nobody
# needs Docker installed. The SDK image is 9.0 (its newest feature band); global.json
# pins 9.0.200 (the first band that reads .slnx) with rollForward latestFeature, so the image and a laptop use the
# same major and the same analyzers. Raise all three together.
# ===========================================================================

FROM node:22-alpine AS web
WORKDIR /src

# A Windows console streaming the registry's log crashes on the tick characters
# some tools print, so the noisy ones are told to be quiet.
ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY src/web/package.json src/web/package-lock.json ./src/web/
RUN npm ci --prefix src/web

COPY src/web ./src/web
# The web apps compile in the language list and load the server's string bundles.
COPY build/contracts ./build/contracts
COPY src/App.Domain/Localization/Resources ./src/App.Domain/Localization/Resources

# The output goes to a file and is shown only on failure (see the note on tick characters above).
RUN mkdir -p ./src/App.Api/wwwroot \
 && (npm run build --prefix src/web > /tmp/web-build.log 2>&1 || (cat /tmp/web-build.log && exit 1))

FROM mcr.microsoft.com/dotnet/sdk:9.0 AS publish
ARG RUN_TESTS=true
WORKDIR /src

COPY . .
COPY --from=web /src/src/App.Api/wwwroot/app ./src/App.Api/wwwroot/app
COPY --from=web /src/src/App.Api/wwwroot/portal ./src/App.Api/wwwroot/portal

RUN dotnet restore tests/App.Tests/App.Tests.csproj
# Database tests skip here (no LocalDB on Linux, no TEST_SQL_CONNECTION); CI runs them against SQL Server.
RUN if [ "$RUN_TESTS" = "true" ]; then dotnet test tests/App.Tests --no-restore --configuration Release; fi
RUN dotnet publish src/App.Api/App.Api.csproj \
    --configuration Release \
    --no-restore \
    --output /app/publish \
    -p:UseAppHost=false

# Asserted rather than trusted: an image without the web apps starts, passes its probes and serves a blank page.
RUN test -f /app/publish/wwwroot/app/index.html && test -f /app/publish/wwwroot/portal/index.html \
 || (echo 'The web build did not reach the image: wwwroot/app or wwwroot/portal is missing.' && exit 1)

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_gcServer=0
EXPOSE 8080
COPY --from=publish /app/publish .
# The aspnet image's built-in non-root user.
USER $APP_UID
ENTRYPOINT ["dotnet", "App.Api.dll"]
