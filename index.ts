import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws"
import * as eks from "@pulumi/eks";
import * as pulumi from "@pulumi/pulumi";
import * as iam from "./iam";
import * as utils from "./utils";
import * as k8s from "@pulumi/kubernetes";
import * as helm from "@pulumi/kubernetes/helm";

const projectName = pulumi.getProject();

// Allocate a new VPC with custom settings, and a public & private subnet per AZ.
const vpc = new awsx.ec2.Vpc(`${projectName}`, {
    cidrBlock: "172.16.0.0/16",
    subnets: [{ type: "public" }, { type: "private" }],
});

// Export VPC ID and Subnets.
export const vpcId = vpc.id;
export const allVpcSubnets = pulumi.all([vpc.privateSubnetIds, vpc.publicSubnetIds])
                            .apply(([privateSubnetIds, publicSubnetIds]) => privateSubnetIds.concat(publicSubnetIds));

// Create 3 IAM Roles and matching InstanceProfiles to use with the nodegroups.
const roles = iam.createRoles(projectName, 3);
const instanceProfiles = iam.createInstanceProfiles(projectName, roles);

// Create an EKS cluster.
const elkCluster = new eks.Cluster(`${projectName}`, {
    version: "1.22",
    vpcId: vpcId,
    subnetIds: allVpcSubnets,
    nodeAssociatePublicIpAddress: false,
    skipDefaultNodeGroup: true,
    deployDashboard: false,
    instanceRoles: roles,
    enabledClusterLogTypes: ["api", "audit", "authenticator",
        "controllerManager", "scheduler"],
});
export const kubeconfig = elkCluster.kubeconfig;
export const clusterName = elkCluster.core.cluster.name;

// Create a Standard node group of t2.micro workers.
const ngMicro = utils.createNodeGroup(`${projectName}-ng-micro`, {
    ami: "ami-0e0b320630373ee54", // k8s v1.22 in eu-west-1
    instanceType: "t2.micro",
    desiredCapacity: 2,
    cluster: elkCluster,
    instanceProfile: instanceProfiles[0],
});

const ngSmall = utils.createNodeGroup(`${projectName}-ng-small`, {
    ami: "ami-0e0b320630373ee54", // k8s v1.22 in eu-west-1
    instanceType: "t2.small",
    desiredCapacity: 2,
    cluster: elkCluster,
    instanceProfile: instanceProfiles[1],
});

const elkK8s = new k8s.Provider("elkK8s", {
    kubeconfig: elkCluster.kubeconfig.apply(JSON.stringify),
});

const elastic = new helm.v2.Chart("elastic", {
    //repo: "elastic",
    chart: "elasticsearch",
    fetchOpts: {
        repo: "https://helm.elastic.co"
    }
}, { providers: { kubernetes: elkK8s } });

const kibana = new helm.v2.Chart("kibana", {
    //repo: "elastic",
    chart: "kibana",
    fetchOpts: {
        repo: "https://helm.elastic.co",
    }
}, { providers: { kubernetes: elkK8s }});

const metricbeat = new helm.v2.Chart("metricbeat", {
    //repo: "elastic",
    chart: "metricbeat",
    fetchOpts: {
        repo: "https://helm.elastic.co",
    }
}, { providers: { kubernetes: elkK8s }});
