using System;
using System.IO;
using System.Linq;
using System.Text;
using ConveyorRouting.Api.Data;
using ConveyorRouting.Api.Interfaces.ICommon;
using ConveyorRouting.Api.Interfaces.IRepository;
using ConveyorRouting.Api.Interfaces.IServices;
using ConveyorRouting.Api.Models;
using ConveyorRouting.Api.Repositories;
using ConveyorRouting.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Newtonsoft.Json;

namespace ConveyorRouting.Api
{
    public class Startup
    {
        public const string ApiPolicy = "Api";

        public Startup(IConfiguration configuration)
        {
            Configuration = configuration;
        }

        public IConfiguration Configuration { get; }

        public void ConfigureServices(IServiceCollection services)
        {
            services.AddScoped<IDbOperations, DbOperations>();
            services.AddScoped<IRimValidationRepository, RimValidationRepository>();
            services.AddScoped<IRimFixRepository, RimFixRepository>();
            services.AddScoped<IRimValidationService, RimValidationService>();
            services.AddScoped<IRimFixService, RimFixService>();

            services.Configure<JwtSettings>(Configuration.GetSection("JwtSecret"));
            services.Configure<RimValidationSettings>(Configuration.GetSection("RimValidation"));

            var jwtSettings = Configuration.GetSection("JwtSecret").Get<JwtSettings>() ?? new JwtSettings();
            if (string.IsNullOrEmpty(jwtSettings.Key) || jwtSettings.Key.Length < 32)
                throw new InvalidOperationException("JwtSecret:Key must be set (32+ characters)");
            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.Key));
            var requireJwt = Configuration.GetValue("RimValidation:RequireJwt", true);

            services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                .AddJwtBearer(options =>
                {
                    options.TokenValidationParameters = new TokenValidationParameters
                    {
                        ValidateIssuer = false,
                        ValidateAudience = false,
                        ValidateLifetime = true,
                        ValidateIssuerSigningKey = true,
                        IssuerSigningKey = key
                    };
                });

            // With RequireJwt=false the API is open (e.g. on a closed plant network); writes stay guarded.
            services.AddAuthorization(options =>
                options.AddPolicy(ApiPolicy, p => p.RequireAssertion(ctx =>
                    !requireJwt || (ctx.User.Identity != null && ctx.User.Identity.IsAuthenticated))));

            services.AddControllers()
                .AddNewtonsoftJson(o =>
                {
                    o.SerializerSettings.DateFormatString = "yyyy-MM-dd'T'HH:mm:ss";
                    o.SerializerSettings.NullValueHandling = NullValueHandling.Include;
                })
                // Model-binding errors in the same OEMResponse envelope
                .ConfigureApiBehaviorOptions(o => o.InvalidModelStateResponseFactory = ctx =>
                {
                    var msg = string.Join("; ", ctx.ModelState
                        .Where(e => e.Value.Errors.Count > 0)
                        .Select(e => $"{e.Key}: {e.Value.Errors.First().ErrorMessage}"));
                    return new ObjectResult(OEMResponse.Fail(422, msg)) { StatusCode = 422 };
                });

            var origins = Configuration.GetSection("Cors:Origins").Get<string[]>() ?? new[] { "http://localhost:3000" };
            services.AddCors(options => options.AddPolicy("AllowOrigin", builder =>
                builder.WithOrigins(origins).AllowAnyMethod().AllowAnyHeader()));

            services.AddSwaggerGen(c =>
            {
                c.SwaggerDoc("v1", new OpenApiInfo { Title = "ConveyorRouting.Api", Version = "v1" });
                c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
                {
                    Description = "JWT Authorization header using the Bearer scheme. Example: \"Bearer {token}\"",
                    Name = "Authorization",
                    In = ParameterLocation.Header,
                    Type = SecuritySchemeType.ApiKey
                });
                c.AddSecurityRequirement(new OpenApiSecurityRequirement
                {
                    {
                        new OpenApiSecurityScheme
                        {
                            Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
                        },
                        Array.Empty<string>()
                    }
                });
            });
        }

        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
            if (env.IsDevelopment())
                app.UseDeveloperExceptionPage();

            app.UseSwagger();
            app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "ConveyorRouting.Api v1"));

            // The React build (frontend/ -> npm run build) is copied into wwwroot
            app.UseDefaultFiles();
            app.UseStaticFiles();

            app.UseRouting();
            app.UseCors("AllowOrigin");
            app.UseAuthentication();
            app.UseAuthorization();

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapControllers();
                // Unknown /api paths are 404s; anything else is the single-page app
                endpoints.MapFallback("/api/{**path}", ctx =>
                {
                    ctx.Response.StatusCode = 404;
                    return ctx.Response.WriteAsync("");
                });
                var index = Path.Combine(env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot"), "index.html");
                if (File.Exists(index))
                    endpoints.MapFallbackToFile("index.html");
            });
        }
    }
}
